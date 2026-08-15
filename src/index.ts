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
import { findCapability } from './tools/find-capability.ts'
import { lookupItem } from './tools/lookup-item.ts'
import { substrateInfo } from './tools/substrate-info.ts'
import { makeRecordMastery } from './tools/record-mastery.ts'
import { makeLearnerProgress } from './tools/learner-progress.ts'

export const name = 'k12-substrate'
export const inject = ['tools']

export interface Config {
  /** 学习者档案存放目录。默认 ~/.dsh-k12-substrate/profiles/，永不外发 */
  profileDir?: string
  /** 关掉档案读写，只留查询工具。给不需要记录学情的场景用 */
  readOnly?: boolean
}

export function apply(ctx: Context, config: Config = {}): void {
  const profileDir = config.profileDir?.trim() || defaultProfileDir()

  ctx.tools.register(substrateInfo)
  ctx.tools.register(findCapability)
  ctx.tools.register(lookupItem)

  if (!config.readOnly) {
    ctx.tools.register(makeRecordMastery(profileDir))
    ctx.tools.register(makeLearnerProgress(profileDir))
  }
}

export { findCapability, lookupItem, substrateInfo, makeRecordMastery, makeLearnerProgress }
export * from './data.ts'
export * as profile from './profile.ts'
