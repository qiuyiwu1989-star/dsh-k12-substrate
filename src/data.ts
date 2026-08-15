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
  reviewStatus: string
  humanConfirmed: boolean
  pendingObjection: boolean
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
