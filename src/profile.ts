/**
 * profile.ts — 学习者档案（L3）的本地存储。
 *
 * **这一层的数据永远不离开本机。** 它是某个具体孩子会什么、不会什么的记录，
 * 属于未成年人的学习画像。底座仓库里用 .gitignore 拦着它，这里用两条规矩拦：
 *
 *   1. 只写 profileDir 下的文件，默认 ~/.dsh-k12-substrate/profiles/
 *   2. 工具的 output.render 不回显具体条目内容，只回显计数
 *
 * 第 2 条不是洁癖：工具返回值会进模型上下文，进而可能被写进会话日志、
 * 被压缩、被发给模型提供方。计数是必要的（不然产品没法用），
 * 逐字逐词的掌握明细不是。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 一条掌握断言。字段与上游 schema 对齐，换成真实产品可直接互通。 */
export interface Assertion {
  assertionId: string
  subject: string
  predicate: 'MASTERED'
  anchorId: string
  /** 清单类锚点要指到具体条目：哪个字、哪个词、哪篇 */
  listRef: { listId: string; key: string } | null
  level: number
  validFrom: string
  holder: string
  /** AI 写入一律 proposed。沉默不算确认 —— 这条是上游定的，这里不破。 */
  confidence: 'proposed' | 'confirmed'
  evidence: string[]
  sourceApp: string
  schemaVersion: string
}

export interface Profile {
  subject: string
  createdAt: string
  assertions: Assertion[]
}

export function defaultProfileDir(): string {
  return join(homedir(), '.dsh-k12-substrate', 'profiles')
}

/** 学习者 id 直接进文件名，必须挡住路径穿越 */
export function safeSubject(subject: string): string {
  const s = subject.trim()
  if (!s) throw new Error('learner 不能为空')
  if (!/^[A-Za-z0-9_\-.]{1,64}$/.test(s)) {
    throw new Error(
      `learner「${subject}」含非法字符。只允许字母、数字、下划线、连字符、点，最长 64 位。` +
      `建议用不含真实姓名的代号（如 stu_0001）—— 档案文件名会落在磁盘上。`,
    )
  }
  if (s === '.' || s === '..') throw new Error('learner 不能是 . 或 ..')
  return s
}

function pathOf(dir: string, subject: string): string {
  return join(dir, `${safeSubject(subject)}.profile.json`)
}

export function read(dir: string, subject: string): Profile {
  const p = pathOf(dir, subject)
  if (!existsSync(p)) {
    return { subject: safeSubject(subject), createdAt: new Date().toISOString(), assertions: [] }
  }
  return JSON.parse(readFileSync(p, 'utf8')) as Profile
}

export function write(dir: string, profile: Profile): string {
  mkdirSync(dir, { recursive: true })
  const p = pathOf(dir, profile.subject)
  writeFileSync(p, JSON.stringify(profile, null, 2), 'utf8')
  return p
}

/** 已掌握的锚点集合 */
export function masteredAnchors(profile: Profile): Set<string> {
  return new Set(profile.assertions.map((a) => a.anchorId))
}

/**
 * 清单条目的去重键。**只有这一个定义。**
 *
 * 教训：这个格式原先在 profile.ts、record-mastery.ts、learner-progress.ts
 * 各写了一遍模板字符串，其中一处的分隔符是字面 NUL 字节、另两处是空格 ——
 * 于是「已掌握」集合永远匹配不上，表现为重复写入不去重、已掌握的字还被推荐。
 * typecheck 抓不到（三处都是合法 string），自测才抓到。
 */
export function itemKey(listId: string, key: string): string {
  return `${listId}\u001f${key}`   // 单元分隔符，不会出现在字/词里
}

/** 已掌握的清单条目 */
export function masteredItems(profile: Profile): Set<string> {
  const out = new Set<string>()
  for (const a of profile.assertions) {
    if (a.listRef) out.add(itemKey(a.listRef.listId, a.listRef.key))
  }
  return out
}
