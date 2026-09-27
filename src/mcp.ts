/**
 * mcp.ts — 经宿主的 MCP 桥去调底座的 MCP server；调不到就如实说调不到。
 *
 * ## 为什么要走 MCP
 *
 * 底座的 MCP server（os-k12-taxonomy/mcp/server.mjs）旁边站着一个调用计数器：
 * 只记「哪条锚点被碰过几次」，不记查询内容、不联网。它是底座唯一能替代教师签字
 * 的信号 —— 长期没人映射得上的锚点，大概率是坏锚点。
 * 本插件读的是随包快照，快照上的查询计数器永远看不见。
 *
 * ## 怎么走
 *
 * 不在插件里自己起子进程、手写 JSON-RPC。DSH 有官方 MCP 桥
 * `@deepseek-ai/dsh-mcp-client`：一个 patch 行连一个 server，把它的工具注册成
 * `mcp__<serverName>__<tool>`。本插件的工具在执行时用 `ctx.tools.execute()`
 * 做嵌套调用（`parent` = 本次执行的 token，和官方 run_code 桥同一种写法），
 * 所以这次子调用照样过宿主的审批、超时与取消。
 *
 * ## 调不到的时候
 *
 * 没挂 MCP 桥、桥没连上、子调用被拒、返回形状不对 —— 一律退回快照，
 * 并把**走了哪条路、为什么**写进工具返回值（进会话日志、界面卡片看得见）。
 * 不许静默回落：用户和模型都得知道这次结果有没有经过底座的现行数据。
 *
 * ## 不许做的事
 *
 * 不许为了让计数器动而额外调 MCP。每一次子调用都必须是这次查询**真正取数据**
 * 的那一步 —— 被自家流量刷高的指标，比没有指标更糟。
 */
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

/** 走了哪条路。写进工具返回值，不只写日志 —— 日志没人看，返回值模型会复述 */
export interface Route {
  via: 'mcp' | 'snapshot'
  /** 走 MCP 时是 mcp__<server>__<tool>；走快照时为空串 */
  tool: string
  /** 数据版本：走 MCP 是底座现行版本，走快照是快照的来源版本 */
  dataVersion: string
  /** 为什么走这条路。走快照时必须说清楚是没配、没连上还是调失败 */
  note: string
}

export type McpOutcome =
  | { ok: true; tool: string; data: Record<string, unknown> }
  | { ok: false; reason: string }

/** 嵌套调用需要的那一小片宿主能力。单测用假的，运行时是 ctx.tools */
export interface ToolsLike {
  get(name: string, scope?: object): unknown
  execute(input: {
    callId: ToolRunContext['callId']
    rootCallId?: ToolRunContext['callId']
    name: string
    arguments: unknown
    agent?: ToolRunContext['agent']
    parent?: ToolRunContext['token']
    signal: AbortSignal
  }): Promise<{ isError: boolean; value?: unknown; error?: { message: string } }>
}

export interface McpBridge {
  /** 配置的 serverName；空串 = 显式关掉 MCP 路由 */
  readonly serverName: string
  call(exec: ToolRunContext, tool: string, args: Record<string, unknown>): Promise<McpOutcome>
  /**
   * 只看宿主里有没有这个 MCP 工具，**不调用**。null = 挂着；否则返回原因。
   * 给「报告走哪条路」用 —— 报告状态不许顺手调一次 MCP，那会被计数。
   */
  probe(exec: ToolRunContext, tool: string): string | null
}

/** dsh-mcp-client 对 serverName 的约束，照抄过来在配置期就挡掉 */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

export function makeMcpBridge(tools: ToolsLike | undefined, serverName: string): McpBridge {
  const name = serverName.trim()
  if (name && !SERVER_NAME.test(name)) {
    throw new Error(`mcpServerName 不合法：${JSON.stringify(serverName)}（只许 [A-Za-z0-9_-]，1–32 位）`)
  }
  let seq = 0
  const probe = (exec: ToolRunContext, tool: string): string | null => {
    if (!name) return '配置里 mcpServerName 为空，MCP 路由已关闭'
    if (!tools) return '宿主没有提供 tools 服务'
    const fq = `mcp__${name}__${tool}`
    // 按调用方的 agent 作用域查 —— MCP 工具可能只挂在某个 agent 的作用域里
    if (!tools.get(fq, exec.agent)) {
      return `宿主里没有 ${fq}：没挂底座 MCP（@deepseek-ai/dsh-mcp-client，serverName: ${name}），或它没连上`
    }
    return null
  }
  return {
    serverName: name,
    probe,
    async call(exec, tool, args) {
      const missing = probe(exec, tool)
      if (missing || !tools) return { ok: false, reason: missing ?? '宿主没有提供 tools 服务' }
      const fq = `mcp__${name}__${tool}`
      seq += 1
      let r
      try {
        r = await tools.execute({
          // 子调用的 id 挂在父调用下面，会话日志里能对回是谁发起的
          callId: `${String(exec.callId)}:k12-mcp:${seq}` as ToolRunContext['callId'],
          rootCallId: exec.rootCallId,
          name: fq,
          arguments: args,
          ...(exec.agent ? { agent: exec.agent } : {}),
          parent: exec.token,
          signal: exec.signal,
        })
      } catch (e) {
        return { ok: false, reason: `${fq} 调用异常：${e instanceof Error ? e.message : String(e)}` }
      }
      if (r.isError) return { ok: false, reason: `${fq} 调用失败：${r.error?.message ?? '未知错误'}` }
      const data = parseMcpValue(r.value)
      if (!data) return { ok: false, reason: `${fq} 返回形状不认识（期望一个 JSON 文本块）` }
      if (typeof data.error === 'string') return { ok: false, reason: `${fq} 报错：${data.error}` }
      return { ok: true, tool: fq, data }
    },
  }
}

/**
 * MCP 桥的规范返回值是 `{ content: [...MCP 内容块], structuredContent? }`。
 * 底座 server 把整个结果 JSON.stringify 进第一个 text 块。
 */
export function parseMcpValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { content?: unknown; structuredContent?: unknown }
  if (v.structuredContent && typeof v.structuredContent === 'object') {
    return v.structuredContent as Record<string, unknown>
  }
  if (!Array.isArray(v.content)) return null
  const block = v.content.find(
    (b): b is { type: 'text'; text: string } =>
      !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text'
      && typeof (b as { text?: unknown }).text === 'string',
  )
  if (!block) return null
  try {
    const parsed: unknown = JSON.parse(block.text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}
