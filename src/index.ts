/**
 * dsh-k12-substrate — DeepSeek Harness 插件入口。
 *
 * 把中国 K12 能力底座接进 harness：模型可以查课标能力锚点、查字表词表篇目、
 * 把某个孩子的掌握情况写进本机档案、算出识字量与下一步。
 *
 * 数据来自 https://github.com/qiuyiwu1989-star/k12-knowledge-substrate
 * 只有通过「判定客观、无需教师复核」门槛的锚点才随包分发。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defaultProfileDir } from './profile.ts'
import { findCapability, makeFindCapability } from './tools/find-capability.ts'
import { lookupItem } from './tools/lookup-item.ts'
import { substrateInfo, makeSubstrateInfo } from './tools/substrate-info.ts'
import { makeMcpBridge } from './mcp.ts'
import { makeRecordMastery } from './tools/record-mastery.ts'
import { makeLearnerProgress } from './tools/learner-progress.ts'

export const name = 'k12-substrate'
export const inject = ['tools']

export interface Config {
  /** 学习者档案存放目录。默认 ~/.dsh-k12-substrate/profiles/，永不外发 */
  profileDir?: string
  /** 关掉档案读写，只留查询工具。给不需要记录学情的场景用 */
  readOnly?: boolean
  /**
   * 底座 MCP server 在宿主里的 serverName（即 @deepseek-ai/dsh-mcp-client 那一行的
   * config.serverName）。默认 'k12'；设为空串则关掉 MCP 路由，全部走随包快照。
   * 宿主里没挂这个 server 时自动退回快照，并在返回值里说明。
   */
  mcpServerName?: string
}

export function apply(ctx: Context, config: Config = {}): void {
  const profileDir = config.profileDir?.trim() || defaultProfileDir()
  // 检索经宿主的 MCP 桥去调底座 MCP server（见 src/mcp.ts）。
  // 桥只在工具执行时按名字找 mcp__<server>__*，所以和 MCP 那一行谁先激活无关。
  const mcp = makeMcpBridge(ctx.tools, config.mcpServerName ?? 'k12')

  ctx.tools.register(makeSubstrateInfo(mcp))
  ctx.tools.register(makeFindCapability(mcp))
  ctx.tools.register(lookupItem)

  if (!config.readOnly) {
    ctx.tools.register(makeRecordMastery(profileDir))
    ctx.tools.register(makeLearnerProgress(profileDir))
  }
}

export {
  findCapability, makeFindCapability, lookupItem, substrateInfo, makeSubstrateInfo,
  makeRecordMastery, makeLearnerProgress,
}
export { makeMcpBridge, parseMcpValue, type McpBridge, type Route } from './mcp.ts'
export * from './data.ts'
export * as profile from './profile.ts'
