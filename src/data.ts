/**
 * data.ts — 加载随包分发的底座快照，建索引。
 *
 * 快照是构建期从 os-k12-taxonomy 导出的，只含 auto-confirmed 锚点。
 * 运行时不联网、不读源仓库 —— 装在谁的机器上都一样。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Anchor {
  id: string
  discipline: string
  track: 'DAG' | 'LIST' | 'MATRIX'
  strand: string | null
  statement: string
  verb: string
  object: string
  stage: { min: string; max: string } | null
  assessment: string | null
  evidence: string[]
  basis: string[]
  source: string | null
  itemCount: number | null
  stageTargets: { stage: string; band: string; target: number }[] | null
  reviewStatus: string
  humanConfirmed: boolean
  pendingObjection: boolean
  /**
   * 字段级缺陷，**与 reviewStatus 分开**。断言成立不等于每个字段都好：
   *   evidence-weak              掌握证据写得弱
   *   stage                      学段可能标错
   *   independent-check-suspect  独立路径验证没抽出这条（底座那边只标记不降级）
   * 产品要显示它 —— 「可引用」不等于「每个字段都可靠」。
   */
  fieldIssues: string[]
}

/** 清单条目。字段名压过，见 scripts/build-snapshot.mjs */
export interface ListItem {
  l: string           // listId
  k: string           // 字 / 词 / 篇目名
  n: string           // HANZI | WORD | RECITE
  s: number | null    // 表内序号
  g: string | null    // 学段
  t: string[]         // 标签：字表一 / 写 / 认 …
  a: string[]         // 挂在哪些可用锚点上
  m: Record<string, unknown> | null
}

export interface ListMeta {
  id: string
  kind: string | null
  count: number
  anchorIds: string[]
  tables: string[]
}

export interface Edge {
  to: string
  from: string
  strength: string
  /**
   * 先修关系的四类语义（底座 specs/001，2026-08-20 起有值）。
   * 快照里**不含 convention** —— 那类是「教材就这么排的、无可观测影响」，
   * 拿它算「下一步学什么」会给出没有依据的建议，所以在导出时就滤掉了。
   *
   *   component  前置是后继的子动作，不可绕过
   *   instrument 拿前置当手段，**可以绕过**，只是绕远路
   *   semantic   不懂前置则后继的表述本身没有意义，不可绕过
   */
  type: 'component' | 'instrument' | 'semantic' | null
  /**
   * 不具备前置时的**具体可观察失败表现**。
   * 这是这条边的判据本身，也是给家长解释「为什么要先学这个」时
   * 唯一拿得出手的东西 —— 比「因为它是前置」有用得多。
   */
  failureSignature: string | null
  /** 强度被设计规则压回 soft 的原因（MATRIX 档学科不许标 hard）。 */
  strengthCappedBy: string | null
  reason: string
  reviewStatus: string
  containment: unknown
}

export interface Snapshot {
  schemaVersion: string
  sourceCommit: string | null
  sourceRepo: string
  standard: string
  counts: {
    anchorsUsable: number
    anchorsPendingObjection: number
    anchorsTotal: number
    listItems: number
    edges: number
  }
  anchors: Anchor[]
  lists: Record<string, ListItem[]>
  listMeta: ListMeta[]
  edges: Edge[]
}

const HERE = dirname(fileURLToPath(import.meta.url))

let cached: Snapshot | undefined

/** 快照文件位置：打包后是 lib/index.js 旁边的 ../data/substrate.json */
function locate(): string {
  const candidates = [
    join(HERE, '..', 'data', 'substrate.json'),   // 发布后：lib/ → ../data
    join(HERE, '..', '..', 'data', 'substrate.json'), // 源码跑：src/ → ../data
  ]
  for (const c of candidates) {
    try { readFileSync(c); return c } catch { /* 试下一个 */ }
  }
  throw new Error(
    `找不到底座快照 substrate.json。开发环境请先跑 \`pnpm snapshot\`。已试过：\n${candidates.join('\n')}`,
  )
}

export function load(): Snapshot {
  if (!cached) cached = JSON.parse(readFileSync(locate(), 'utf8')) as Snapshot
  return cached
}

// ── 索引 ──────────────────────────────────────────────────────────

let idx: {
  byId: Map<string, Anchor>
  /** 字/词/篇目 → 命中的清单条目。同一个字可能同时在字表一和基本字表里 */
  byKey: Map<string, ListItem[]>
  prereqs: Map<string, Edge[]>
} | undefined

export function index() {
  if (idx) return idx
  const snap = load()
  const byId = new Map(snap.anchors.map((a) => [a.id, a]))
  const byKey = new Map<string, ListItem[]>()
  for (const items of Object.values(snap.lists)) {
    for (const it of items) {
      const arr = byKey.get(it.k)
      if (arr) arr.push(it)
      else byKey.set(it.k, [it])
    }
  }
  const prereqs = new Map<string, Edge[]>()
  for (const e of snap.edges) {
    const arr = prereqs.get(e.to)
    if (arr) arr.push(e)
    else prereqs.set(e.to, [e])
  }
  idx = { byId, byKey, prereqs }
  return idx
}

/** 锚点存在且可用（快照里只有可用的，所以存在即可用） */
export function getAnchor(id: string): Anchor | undefined {
  return index().byId.get(id)
}

const STAGE_NUM = (s: string) => Number(/^G(\d+)$/.exec(s)?.[1] ?? NaN)

/** 学段是否落在锚点的 stageHint 区间内 */
export function inStage(a: Anchor, stage: string): boolean {
  if (!a.stage) return true
  const g = STAGE_NUM(stage)
  const lo = STAGE_NUM(a.stage.min)
  const hi = STAGE_NUM(a.stage.max)
  if (Number.isNaN(g)) return true
  if (Number.isNaN(lo) || Number.isNaN(hi)) return true
  return g >= lo && g <= hi
}
