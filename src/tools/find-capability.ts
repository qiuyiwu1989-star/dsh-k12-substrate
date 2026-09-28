/**
 * k12_find_capability — 按学科/学段/关键词检索能力锚点。
 *
 * 返回的每条锚点都带 `assessment`（照着问的那句话）和 `basis`
 * （凭什么不用等老师复核）。模型被追问「你怎么知道」时要能答出来。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { load, index, getAnchor, inStage, type Anchor } from '../data.ts'
import { makeMcpBridge, type McpBridge, type Route } from '../mcp.ts'

// 描述里的数字必须从快照读。写死过一次「143 条」，加了 3 条锚点之后
// 工具描述就开始对模型说谎了 —— 而模型会照着它回答用户。
const N = load().counts.anchorsUsable
const P = load().counts.anchorsPendingObjection

// 注意：这个节点是被 `items:` 引用的，根上不能有 required —— DSL 只允许
// required 出现在 properties 的直接子项上。typecheck 抓不到，运行时会抛
// UNSUPPORTED_SCHEMA。
const anchorNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true, description: '锚点稳定 ID，写档案时用它' },
    discipline: { type: 'string', required: true },
    track: { type: 'string', required: true, description: 'LIST=清单覆盖型，DAG=有先后依赖，MATRIX=能力维度×主题' },
    strand: { type: 'string', required: true, description: '课标学习领域，可能为空' },
    statement: { type: 'string', required: true, description: '可判定的能力断言' },
    stageMin: { type: 'string', required: true },
    stageMax: { type: 'string', required: true },
    assessment: { type: 'string', required: true, description: '给家长/老师照着问的一句话，{{name}} 是孩子名字占位符' },
    evidence: { type: 'array', required: true, items: { type: 'string' }, description: '判定为「会」的具体表现' },
    basis: { type: 'array', required: true, items: { type: 'string' }, description: '这条为什么不需要教师复核就可用' },
    itemCount: { type: 'integer', required: true, description: '清单类锚点下挂多少条目；非清单类为 0' },
    pendingObjection: { type: 'boolean', required: true, description: 'true = AI 裁定或 AI 复核、尚无人签字，引用时应向用户说明' },
    fieldIssues: { type: 'array', required: true, items: { type: 'string' }, description: '字段级缺陷（证据弱 / 学段存疑 / 独立验证没抽出这条）。**可引用不等于每个字段都可靠**，引用时该一并说明' },
    grainWarning: { type: 'string', description: '粒度警告（只有经底座 MCP 检索时才有）。这条覆盖几个年级 —— 映射「成功」不等于信息量够，照它说的办' },
    why: { type: 'array', items: { type: 'string' }, description: '为什么被检索到（只有经底座 MCP 检索时才有）：字面命中了哪些词、学段是否吻合' },
    prerequisites: {
      type: 'array', required: true,
      description: '直接前置。每条带 type（component 子动作 / instrument 手段可绕 / semantic 概念前提）'
        + '和 failureSignature（不具备时的具体可观察失败表现）——'
        + '**要跟用户解释「为什么得先学这个」，用 failureSignature，别用「因为它是前置」**。',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          statement: { type: 'string', required: true },
          type: { type: 'string', required: true, description: 'component | instrument | semantic' },
          strength: { type: 'string', required: true, description: 'hard = 不具备就卡死；soft = 能到但更慢' },
          canBypass: { type: 'boolean', required: true, description: 'true = instrument，换个办法也能到' },
          failureSignature: { type: 'string', required: true, description: '不具备这条前置时的具体可观察失败表现' },
        },
      },
    },
  },
} as const

function project(a: Anchor) {
  return {
    id: a.id,
    discipline: a.discipline,
    track: a.track,
    strand: a.strand ?? '',
    statement: a.statement,
    stageMin: a.stage?.min ?? '',
    stageMax: a.stage?.max ?? '',
    assessment: a.assessment ?? '',
    evidence: a.evidence,
    basis: a.basis,
    itemCount: a.itemCount ?? 0,
    pendingObjection: !!a.pendingObjection,
    fieldIssues: a.fieldIssues ?? [],
    // 前置带上语义与失败表现（底座 specs/001，2026-08-20 起有值）。
    // 快照里已经滤掉了 convention 边，所以这里出现的每一条都是有可观测后果的。
    prerequisites: (index().prereqs.get(a.id) ?? []).map((e) => ({
      id: e.from,
      statement: getAnchor(e.from)?.statement ?? '',
      // 空串而不是 null —— 工具返回值的字段声明是 string，
      // 而 null 会让消费方多写一个分支。没有值就是没有值，空串已经说清楚了。
      type: e.type ?? '',
      strength: e.strength,
      canBypass: e.type === 'instrument',
      failureSignature: e.failureSignature ?? '',
    })),
  }
}

const routeNode = {
  type: 'object',
  required: true,
  additionalProperties: false,
  description: '这次结果走的哪条路。via=mcp：经底座 MCP server，用底座现行数据与底座的检索算法；'
    + 'via=snapshot：用随包快照（可能落后于底座），note 说明为什么没走 MCP',
  properties: {
    via: { type: 'string', required: true, description: 'mcp | snapshot' },
    tool: { type: 'string', required: true, description: '走 MCP 时调的工具全名；走快照为空串' },
    dataVersion: { type: 'string', required: true, description: '数据版本' },
    note: { type: 'string', required: true, description: '为什么走这条路 / 这条路的局限' },
  },
} as const

function snapshotVersion(): string {
  const s = load()
  return s.sourceVersion ? `快照 v${s.sourceVersion}` : `快照 @${s.sourceCommit ?? '?'}`
}

/** 快照上的检索：字面包含。MCP 不可用、或纯列举（无关键词）时走这里 */
function searchSnapshot(args: { query?: string; discipline?: string; stage?: string }, limit: number) {
  const snap = load()
  const q = args.query?.trim()
  let hits = snap.anchors
  if (args.discipline) {
    const d = args.discipline.trim()
    hits = hits.filter((a) => a.discipline === d)
  }
  if (args.stage) {
    const s = args.stage.trim().toUpperCase()
    hits = hits.filter((a) => inStage(a, s))
  }
  if (q) {
    hits = hits.filter((a) => a.statement.includes(q) || a.object.includes(q) || (a.strand ?? '').includes(q))
  }
  return { total: hits.length, anchors: hits.slice(0, limit).map(project) }
}

interface McpCandidate { id?: unknown; grain?: { warning?: unknown }; why?: unknown }

/**
 * @param mcp 底座 MCP 的桥。不给（或 serverName 为空）就只走快照 ——
 *            自测用的就是这个形态，所以自测永远碰不到底座的计数器。
 */
export function makeFindCapability(mcp: McpBridge = makeMcpBridge(undefined, '')) {
  return defineTool({
    name: 'k12_find_capability',
    description:
      '检索中国 K12 能力锚点（源自教育部课程标准）。' +
      `可用锚点 ${N} 条，其中 ${P} 条是 AI 判过、无人签字的（pendingObjection）——` +
      '向用户陈述这类锚点时应说明这一点。查不到不等于课标里没有。' +
      '给了 query 时优先经底座 MCP server 检索（底座现行数据 + 底座自己的检索算法，每条带粒度警告）；' +
      'MCP 不可用时退回随包快照做字面匹配。返回值的 route 字段说明这次走的哪条路，引用前看一眼。',
    parameters: {
      query: { type: 'string', description: '检索文本（关键词或一段教学内容）。留空则按学科/学段列举（只走快照）' },
      discipline: { type: 'string', description: '学科，如「语文」「英语」。经 MCP 检索时强烈建议给，不给会跨科召回' },
      stage: { type: 'string', description: '年级 G1–G12，返回该年级适用的锚点' },
      limit: { type: 'integer', description: `返回上限，默认 20，最大 ${N}` },
      deep: {
        type: 'boolean',
        description: 'query 是一道题或一段课堂语言（而不是课标术语）时设 true：底座先把它改写成课标说法再检索，'
          + '再由模型从候选里挑。慢几秒，但字面对不上的内容只有这样找得到'
          + '（底座 100 道真题基准：第一名命中 27% → 61%）。只在经底座 MCP 时生效',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer', required: true, description: '匹配总数（可能大于返回数）。经 MCP 检索时底座只给前 N 条候选，total 等于返回数' },
          returned: { type: 'integer', required: true },
          anchors: { type: 'array', required: true, items: anchorNode },
          route: routeNode,
        },
      },
      render: (_args, value) => {
        const r = value.route
        const head = r.via === 'mcp'
          ? `［经底座 MCP · ${r.dataVersion}］${r.note}`
          : `［走随包快照 · ${r.dataVersion}］${r.note}`
        if (value.returned === 0) {
          return [{ type: 'text', text: `${head}\n没有匹配的锚点。查不到不等于课标里没有。` }]
        }
        const lines = value.anchors.map((a) => {
          const stage = a.stageMin ? ` [${a.stageMin}–${a.stageMax}]` : ''
          const n = a.itemCount ? `　${a.itemCount} 条` : ''
          const p = a.pendingObjection ? '　[AI判过·无人签字]' : ''
          const g = a.grainWarning ? `\n    粒度：${a.grainWarning}` : ''
          return `- ${a.id}${stage} ${a.discipline}｜${a.statement}${n}${p}${g}`
        })
        const more = value.total > value.returned ? `\n（共 ${value.total} 条匹配，已显示 ${value.returned} 条）` : ''
        return [{ type: 'text', text: `${head}\n${lines.join('\n')}${more}` }]
      },
    },
    presentCall: (args) => {
      const bits = [args.discipline, args.stage, args.query].filter(Boolean)
      return {
        card: 'generic',
        title: bits.length ? `检索能力锚点：${bits.join(' · ')}` : '列出全部可用能力锚点',
        kind: 'search',
      }
    },
    // 完成后的卡片标题带上走的哪条路 —— 界面上一眼看得出这次有没有经过底座。
    // 从渲染文本的抬头读，而不是另存状态：回放时只有 content，这样回放也能重现。
    presentResult: (_args, result) => {
      const text = result.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      const via = text.startsWith('［经底座 MCP') ? '经底座 MCP'
        : text.startsWith('［走随包快照') ? '走随包快照' : ''
      return via ? { card: 'generic', title: `检索能力锚点（${via}）` } : { card: 'generic' }
    },

    async execute(args, exec) {
      const limit = Math.min(Math.max(args.limit ?? 20, 1), N)
      const q = args.query?.trim()

      // 纯列举：底座 MCP 的 search_anchors 必须有检索文本，没有等价工具。
      if (!q) {
        const r = searchSnapshot(args, limit)
        const route: Route = {
          via: 'snapshot', tool: '', dataVersion: snapshotVersion(),
          note: '没给 query，按学科/学段列举：底座 MCP 没有等价的列举工具，只能走快照',
        }
        return { total: r.total, returned: r.anchors.length, anchors: r.anchors, route }
      }

      // 有检索文本：优先经底座 MCP。**这一次子调用就是取数据的那一步**，
      // 不是为了让计数器动而额外发的。
      const m = await mcp.call(exec, 'search_anchors', {
        text: q,
        ...(args.discipline ? { discipline: args.discipline.trim() } : {}),
        ...(args.stage ? { stage: args.stage.trim().toUpperCase() } : {}),
        limit,
        // 只要可被档案引用的 —— 和快照的「可用」是同一份定义（底座 mappings/citable.json）
        citableOnly: true,
        ...(args.deep ? { deep: true } : {}),
      })
      if (m.ok && Array.isArray(m.data.candidates)) {
        const anchors: ReturnType<typeof project>[] = []
        const missing: string[] = []
        for (const c of m.data.candidates as McpCandidate[]) {
          const id = typeof c.id === 'string' ? c.id : ''
          const a = id ? getAnchor(id) : undefined
          // 底座比快照新时会出现快照里没有的 ID。不编它的字段，如实报数。
          if (!a) { if (id) missing.push(id); continue }
          const w = c.grain?.warning
          anchors.push({
            ...project(a),
            ...(typeof w === 'string' && w ? { grainWarning: w } : {}),
            ...(Array.isArray(c.why) ? { why: c.why.filter((x): x is string => typeof x === 'string') } : {}),
          })
        }
        const version = typeof m.data.version === 'string' ? `底座 v${m.data.version}` : '底座现行版本'
        const ranking = typeof m.data.ranking === 'string' ? m.data.ranking : ''
        const notes = [
          '底座检索算法（tools/mapper.py），只给前 N 条候选',
          ranking,
          missing.length ? `另有 ${missing.length} 条候选不在随包快照里（快照落后于底座），未列出` : '',
        ].filter(Boolean)
        const route: Route = { via: 'mcp', tool: m.tool, dataVersion: version, note: notes.join('；') }
        return { total: anchors.length, returned: anchors.length, anchors, route }
      }

      const why = m.ok ? `${m.tool} 返回里没有 candidates` : m.reason
      const r = searchSnapshot(args, limit)
      const route: Route = {
        via: 'snapshot', tool: '', dataVersion: snapshotVersion(),
        note: `未经底座 MCP（${why}）；退回快照字面匹配，结果可能落后于底座，也不进底座的使用计数`,
      }
      return { total: r.total, returned: r.anchors.length, anchors: r.anchors, route }
    },
  })
}

/** 只走快照的版本。给不挂宿主的调用方（自测、直接 import）用 */
export const findCapability = makeFindCapability()
