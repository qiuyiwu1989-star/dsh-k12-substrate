/**
 * build-snapshot.mjs — 从 os-k12-taxonomy 仓库导出插件用的数据快照。
 *
 * 为什么要快照而不是直接读源仓库：插件装在别人机器上，那台机器没有 taxonomy
 * 的 checkout。快照随包发布，离线可用。
 *
 * 为什么只导 auto-confirmed：底座的分界线是「能不能写进一个真实孩子的档案」。
 * ai-reviewed 和 disputed 的锚点判定依赖教学判断，还没人复核过 —— 让模型拿去
 * 给孩子下结论，就是把没验过的东西当验过的用。这条在源仓库守着，在这里也必须守。
 *
 *   node scripts/build-snapshot.mjs [taxonomy 仓库路径]
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(process.argv[2] ?? join(HERE, '..', '..', 'os-k12-taxonomy'))
const OUT = join(HERE, '..', 'data')

/** 只有这两档能被档案引用。改这里等于改底座的分界线，别改。 */
const USABLE = new Set(['auto-confirmed', 'expert-confirmed'])

function walk(dir) {
  const out = []
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (e.endsWith('.jsonl')) out.push(p)
  }
  return out
}

const readJsonl = (dir) =>
  walk(join(SRC, dir)).flatMap((f) =>
    readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)),
  )

const anchors = readJsonl('anchors')
const lists = readJsonl('lists')
const edges = readJsonl('edges')

if (!anchors.length) {
  console.error(`✗ 在 ${SRC} 下没读到锚点。传对 taxonomy 仓库路径。`)
  process.exit(1)
}

// ── 锚点：只留可用的，且只留插件真正会用到的字段 ──────────────────
const usable = anchors.filter((a) => !a.deprecated && USABLE.has(a.reviewStatus))
const usableIds = new Set(usable.map((a) => a.id))

const slimAnchors = usable.map((a) => ({
  id: a.id,
  discipline: a.discipline,
  track: a.track,
  strand: a.strand ?? null,
  statement: a.statement,
  verb: a.verb,
  object: a.object,
  stage: a.stageHint ?? null,
  // assessment 是给家长/老师照着问的那句话，产品里直接显示，必须带上
  assessment: a.assessment ?? null,
  evidence: a.evidence ?? [],
  // 凭什么不用等老师 —— 模型被追问时要能答出来，不能只说「系统说的」
  basis: a.autoConfirmBasis ?? [],
  source: a.provenance?.source ?? a.evidenceSource ?? null,
  itemCount: a.provenance?.itemCount ?? null,
  reviewStatus: a.reviewStatus,
}))

// ── 清单条目：这是体量大头，字段压到最小 ──────────────────────────
const slimLists = lists.map((x) => ({
  l: x.listId,          // listId
  k: x.key,             // 字 / 词 / 篇目名
  n: x.kind,            // HANZI | VOCAB | RECITE | ...
  s: x.seq ?? null,     // 表内序号（机械校验过连续性的那个）
  g: x.stage ?? null,   // 学段
  t: x.tags ?? [],      // 字表一 / 写 / 认 …
  a: (x.anchorIds ?? []).filter((id) => usableIds.has(id)),
  m: x.meta ?? null,
}))

// ── 边：只留两端都可用的。目前就是那 2 条实测集合包含边。 ─────────
const slimEdges = edges
  .filter((e) => usableIds.has(e.anchorId) && usableIds.has(e.prerequisiteId))
  .map((e) => ({
    to: e.anchorId,
    from: e.prerequisiteId,
    strength: e.strength,
    reason: e.reason,
    reviewStatus: e.reviewStatus,
    containment: e.containment ?? null,
  }))

// 清单按 listId 归组，运行时省一次全表扫描
const byList = {}
for (const x of slimLists) (byList[x.l] ??= []).push(x)
for (const k of Object.keys(byList)) byList[k].sort((a, b) => (a.s ?? 0) - (b.s ?? 0))

const listMeta = Object.entries(byList).map(([id, items]) => ({
  id,
  kind: items[0]?.n ?? null,
  count: items.length,
  anchorIds: [...new Set(items.flatMap((i) => i.a))],
  tables: [...new Set(items.map((i) => i.m?.table).filter(Boolean))],
}))

const snapshot = {
  schemaVersion: '0.1.0',
  // 快照建于哪个 commit —— 出了问题要能回溯到源仓库的确切状态
  sourceCommit: (() => {
    try {
      return execSync(`git -C "${SRC}" rev-parse --short HEAD`, { encoding: 'utf8' }).trim()
    } catch { return null }
  })(),
  sourceRepo: 'https://github.com/qiuyiwu1989-star/k12-knowledge-substrate',
  standard: '中华人民共和国教育部《义务教育课程标准（2022年版）》',
  counts: {
    anchorsUsable: slimAnchors.length,
    anchorsTotal: anchors.length,
    listItems: slimLists.length,
    edges: slimEdges.length,
  },
  anchors: slimAnchors,
  lists: byList,
  listMeta,
  edges: slimEdges,
}

mkdirSync(OUT, { recursive: true })
const file = join(OUT, 'substrate.json')
writeFileSync(file, JSON.stringify(snapshot))
const kb = (statSync(file).size / 1024).toFixed(0)

console.log(`✓ ${file}  ${kb} KB`)
console.log(`  可用锚点 ${slimAnchors.length} / ${anchors.length}（只导 auto-confirmed / expert-confirmed）`)
console.log(`  清单条目 ${slimLists.length}，分 ${listMeta.length} 张表`)
console.log(`  边 ${slimEdges.length}（两端都可用的才留）`)
for (const m of listMeta) console.log(`    ${m.id.padEnd(30)} ${String(m.count).padStart(5)} 条  ${m.kind}`)
