/**
 * smoke.ts — 不依赖 DSH 运行时，直接调 execute() 验证五个工具。
 *
 * 存在的理由：typecheck 只证明类型自洽，证明不了「查『阿』字返回的是不是字表一第 1 号」。
 * 这里验的都是能出错的地方 —— 真实数据、真实边界、真实落盘。
 *
 *   node --experimental-strip-types scripts/smoke.ts
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findCapability, makeFindCapability } from '../src/tools/find-capability.ts'
import { lookupItem } from '../src/tools/lookup-item.ts'
import { substrateInfo, makeSubstrateInfo } from '../src/tools/substrate-info.ts'
import { makeMcpBridge, type ToolsLike } from '../src/mcp.ts'
import { makeRecordMastery } from '../src/tools/record-mastery.ts'
import { makeLearnerProgress } from '../src/tools/learner-progress.ts'
import { load } from '../src/data.ts'

// 期望值从快照读，不写死 —— 底座会长，写死的断言每次加数据都要改一遍，
// 改着改着就变成「把断言改到跟实际一致」，测试就失去意义了。
const SNAP = load()

let failed = 0
let passed = 0

function ok(cond: unknown, label: string, detail?: unknown): void {
  if (cond) { passed += 1; console.log(`  ✓ ${label}`) }
  else { failed += 1; console.error(`  ✗ ${label}${detail === undefined ? '' : `\n      实际：${JSON.stringify(detail)}`}`) }
}

async function throws(fn: () => Promise<unknown>, label: string, match?: RegExp): Promise<void> {
  try {
    await fn()
    failed += 1
    console.error(`  ✗ ${label} —— 本该抛错却没抛`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (match && !match.test(msg)) {
      failed += 1
      console.error(`  ✗ ${label} —— 抛了错但信息不对：${msg}`)
    } else { passed += 1; console.log(`  ✓ ${label}`) }
  }
}

/** execute 只用到 args，exec 给个最小桩 */
const EXEC = { signal: new AbortController().signal } as never

const DIR = mkdtempSync(join(tmpdir(), 'k12-smoke-'))
const record = makeRecordMastery(DIR)
const progress = makeLearnerProgress(DIR)

try {
  // ── 1. schema 投影 ────────────────────────────────────────────
  // defineTool 在模块加载时就把作者 DSL 编译成了 JSON Schema，编不过会直接抛
  // UNSUPPORTED_SCHEMA。所以这里验的是**编译产物**对不对，不是再编一次。
  // （踩过的坑：required 只能出现在 properties 的直接子项上，放在 items 指向的
  //   节点根上 typecheck 过得去、运行时抛错。）
  console.log('\n【1】五个工具编译出的 JSON Schema')
  for (const t of [substrateInfo, findCapability, lookupItem, record, progress]) {
    const out = t.output.schema as any
    const par = t.parameters as any
    ok(out?.type === 'object' && out.properties, `${t.name} 输出 schema 是对象`)
    ok(!('required' in (out.properties ?? {})), `${t.name} properties 里没有名为 required 的漏网字段`)
    ok(par?.type === 'object', `${t.name} 参数 schema 是对象`)
  }
  // required 必须落成数组形式，且内容正确
  ok(JSON.stringify((lookupItem.parameters as any).required) === '["item"]',
    'lookup_item 的必填参数编译为 ["item"]', (lookupItem.parameters as any).required)
  ok(((findCapability.output.schema as any).required ?? []).includes('anchors'),
    'find_capability 输出把 anchors 标为必返回')
  ok(((substrateInfo.parameters as any).properties ?? {}) && Object.keys((substrateInfo.parameters as any).properties ?? {}).length === 0,
    'substrate_info 无参数')

  // ── 2. 底座自述 ───────────────────────────────────────────────
  console.log('\n【2】k12_substrate_info')
  const info = await substrateInfo.execute({}, EXEC) as any
  ok(info.anchorsUsable === SNAP.counts.anchorsUsable && info.anchorsUsable > 100,
    `可用锚点与快照一致（${info.anchorsUsable}）`)
  ok(info.listItems === SNAP.counts.listItems, `清单条目与快照一致（${info.listItems}）`)
  ok(info.lists.length === SNAP.listMeta.length && info.lists.length >= 8,
    `清单表数与快照一致（${info.lists.length}）`)
  ok(info.limitations.length >= 5, '局限说明至少 5 条')
  ok(info.limitations.some((s: string) => s.includes('无法二值判定')),
    '局限里说明了「感受/体会」类要求是有意舍弃的，不是遗漏')
  ok(!info.limitations.some((s: string) => /数学.*未纳入可用/.test(s)),
    '局限里不再声称数学不可用 —— 它现在有 73 条，说谎比不说更糟')

  // ── 3. 检索 ───────────────────────────────────────────────────
  console.log('\n【3】k12_find_capability')
  const all = await findCapability.execute({ limit: 999 }, EXEC) as any
  ok(all.total === SNAP.counts.anchorsUsable, `不加条件返回全部（${all.total}）`)
  const yuwen = await findCapability.execute({ discipline: '语文' }, EXEC) as any
  ok(yuwen.total > 100, `语文 ${yuwen.total} 条`)
  // 这条原本断言「数学 0 条 —— 诚实的空」。数学现在有真覆盖了，断言换成
  // **每一科的数字都必须和快照对得上** —— 防的还是同一件事：工具不许虚报覆盖。
  const shuxue = await findCapability.execute({ discipline: '数学', limit: 999 }, EXEC) as any
  const mathInSnap = SNAP.anchors.filter((a) => a.discipline === '数学').length
  ok(shuxue.total === mathInSnap, `数学 ${shuxue.total} 条，与快照一致`)
  const fake = await findCapability.execute({ discipline: '不存在的学科' }, EXEC) as any
  ok(fake.total === 0, '不存在的学科返回 0 —— 不许编')
  const bei = await findCapability.execute({ query: '背诵' }, EXEC) as any
  ok(bei.total > 100, `关键词「背诵」命中 >100（实际 ${bei.total}）`)
  ok(all.anchors.every((a: any) => a.id && a.statement), '每条都有 id 和 statement')
  ok(all.anchors.some((a: any) => a.basis.length > 0), '至少有锚点带 basis（凭什么免复核）')
  const g1 = await findCapability.execute({ stage: 'G1', limit: 999 }, EXEC) as any
  ok(g1.total > 0 && g1.total < all.total, `G1 过滤生效（${g1.total}/${all.total}）`)

  // ── 4. 查条目 ─────────────────────────────────────────────────
  console.log('\n【4】k12_lookup_item')
  const a1 = await lookupItem.execute({ item: '阿' }, EXEC) as any
  ok(a1.found, '「阿」查得到')
  ok(a1.matches.some((m: any) => m.table === '字表一' && m.seq === 1), '「阿」是字表一第 1 号', a1.matches)
  const ren = await lookupItem.execute({ item: '人' }, EXEC) as any
  ok(ren.found && ren.matches.length >= 1, `「人」命中 ${ren.matches.length} 处`)
  const nope = await lookupItem.execute({ item: '𰻞' }, EXEC) as any
  ok(!nope.found, '生僻字「𰻞」诚实返回 found:false')
  const jing = await lookupItem.execute({ item: '静夜思' }, EXEC) as any
  ok(jing.found, '《静夜思》按标题查得到（篇目走模糊匹配）', jing)

  // ── 5. 写档案 ─────────────────────────────────────────────────
  console.log('\n【5】k12_record_mastery')
  const jiben = all.anchors.find((a: any) => a.statement.includes('基本字表'))
  ok(!!jiben, '找到基本字表锚点')

  // 用真的在基本字表里的字。这张表收的是部件/字根（入几九了刀力又三干一工土才下大上小口山巾…），
  // 「人」「手」不在里面 —— 第一版测试就是拿它们写的，被工具正确挡下了。
  const r1 = await record.execute(
    { learner: 'stu_TEST01', anchorId: jiben.id, items: ['口', '山', '巾'] }, EXEC) as any
  ok(r1.recorded === 3, `写入 3 条（实际 ${r1.recorded}）`, r1.notInList)
  ok(r1.confidence === 'proposed', 'AI 写入标记为 proposed —— 模型说会了不算数')
  ok(existsSync(r1.profilePath), `档案落盘：${r1.profilePath}`)
  ok(r1.profilePath.startsWith(DIR), '档案落在指定目录内，没跑出去')

  const r2 = await record.execute(
    { learner: 'stu_TEST01', anchorId: jiben.id, items: ['口', '山'] }, EXEC) as any
  ok(r2.recorded === 0 && r2.skippedDuplicate === 2, `重复写入被跳过（新 ${r2.recorded} 跳 ${r2.skippedDuplicate}）`)

  const r3 = await record.execute(
    { learner: 'stu_TEST01', anchorId: jiben.id, items: ['入', '几'], holder: 'teacher:高' }, EXEC) as any
  ok(r3.confidence === 'confirmed', '教师判定标记为 confirmed')
  ok(r3.recorded === 2, `教师确认写入 2 条（实际 ${r3.recorded}）`, r3.notInList)

  const r4 = await record.execute(
    { learner: 'stu_TEST01', anchorId: jiben.id, items: ['澪', '瓩'] }, EXEC) as any
  ok(r4.notInList.length === 2 && r4.recorded === 0, '不在该锚点清单内的条目被拒绝', r4.notInList)

  // 回显不能带出具体条目 —— 这是隐私不变量，不是风格问题
  const rendered = record.output.render({ learner: 'stu_TEST01', anchorId: jiben.id, items: ['口'] } as never, r1)
    .map((b: any) => b.text ?? '').join('')
  ok(!/口.*山.*巾/.test(rendered), '回显不逐条列出已掌握的字（只给计数）', rendered)

  await throws(() => record.execute({ learner: 'stu_TEST01', anchorId: 'ca_NOTREAL' }, EXEC),
    '拒绝不可用锚点', /不在可用集合/)
  await throws(() => record.execute({ learner: '../../etc/passwd', anchorId: jiben.id }, EXEC),
    '拒绝路径穿越的 learner', /非法字符/)
  await throws(() => record.execute({ learner: '  ', anchorId: jiben.id }, EXEC),
    '拒绝空 learner')

  // ── 6. 算进度 ─────────────────────────────────────────────────
  console.log('\n【6】k12_learner_progress')
  const p = await progress.execute({ learner: 'stu_TEST01' }, EXEC) as any
  ok(p.hasProfile, '读到档案')
  ok(p.totals.hanzi === 5, `识字量 5（实际 ${p.totals.hanzi}）`)
  ok(p.totals.confirmed === 2, `教师确认 2 条（实际 ${p.totals.confirmed}）`)
  ok(p.totals.proposed === 3, `AI 待确认 3 条（实际 ${p.totals.proposed}）`)
  ok(p.byAnchor.length >= 1, '按锚点汇总有数据')
  ok(p.byAnchor[0].total === 299, `基本字表总数 299（实际 ${p.byAnchor[0].total}）`)
  ok(p.nextUp.length >= 1, '给出了下一步')
  ok(p.nextUp[0].items.length > 0, '下一步有具体条目')
  ok(!p.nextUp[0].items.some((c: string) => ['口','山','巾','入','几'].includes(c)), '下一步不会推荐已掌握的字', p.nextUp[0].items)
  ok(/不支持跨学科学习路径推荐/.test(p.limitation), '明说了做不到跨学科路径推荐 —— 不许含糊')

  // 学段分母：二年级孩子看到 386/3500 会被吓着，看到 386/1600 才有意义
  const staged = await progress.execute({ learner: 'stu_TEST01', stage: 'G1-2' }, EXEC) as any
  const jb = staged.byAnchor.find((a: any) => a.anchorId === jiben.id)
  ok(jb?.total === 800, `给了 G1-2，基本字表分母取第一学段会写目标 800（实际 ${jb?.total}）`, jb)
  ok(jb?.totalBasis === '第一学段目标', `分母来源标注正确：${jb?.totalBasis}`)
  const unstaged = await progress.execute({ learner: 'stu_TEST01' }, EXEC) as any
  const jb2 = unstaged.byAnchor.find((a: any) => a.anchorId === jiben.id)
  ok(jb2?.total === 299 && jb2?.totalBasis === '清单总量', `不给学段则用清单总量 299（实际 ${jb2?.total}）`)
  const bad = await progress.execute({ learner: 'stu_TEST01', stage: 'G9-9' }, EXEC) as any
  const jb3 = bad.byAnchor.find((a: any) => a.anchorId === jiben.id)
  ok(jb3?.totalBasis === '清单总量', '学段传了不存在的值，退回清单总量而不是崩')

  const empty = await progress.execute({ learner: 'stu_NOBODY' }, EXEC) as any
  ok(!empty.hasProfile && empty.totals.hanzi === 0, '无档案时返回空而不是报错')

  // ── 6b. UI 卡片 ───────────────────────────────────────────────
  console.log('\n【6b】UI 卡片')
  const cards = [substrateInfo, findCapability, lookupItem, record, progress]
  ok(cards.every((t) => typeof (t as any).presentCall === 'function'), '五个工具都有 presentCall')
  const lc = (lookupItem as any).presentCall({ item: '口' })
  ok(lc.card === 'generic' && lc.title.includes('口'), `查询卡标题：${lc.title}`)
  const fc = (findCapability as any).presentCall({ discipline: '语文', stage: 'G1' })
  ok(fc.title.includes('语文') && fc.title.includes('G1'), `检索卡标题：${fc.title}`)

  // 卡片会被持久化进会话日志并在回放时重现 —— 比工具返回值活得更久。
  // 所以隐私不变量在卡片这一侧同样要守：只显条数，不显具体哪些字。
  const rc = (record as any).presentCall(
    { learner: 'stu_TEST01', anchorId: jiben.id, items: ['口', '山', '巾'] })
  ok(!/[口山巾]/.test(rc.title), `写入卡不带出具体条目：${rc.title}`, rc.title)
  ok(rc.title.includes('3'), '写入卡给出条数')

  // 展示器必须是纯函数：同样入参必须同样输出（回放时要能重现）
  const twice = (lookupItem as any).presentCall({ item: '口' })
  ok(JSON.stringify(lc) === JSON.stringify(twice), 'presentCall 是纯函数（两次调用结果相同）')

  // ── 6c. 经底座 MCP 的检索路由 ─────────────────────────────────
  // 这里一律用假的 ctx.tools，**绝不起真的底座 MCP server**：
  // 底座的计数器只该记真实使用，自测污染过一次（读数 112、真实调用 0）。
  console.log('\n【6c】检索路由：MCP 优先，快照兜底')
  const bare = await findCapability.execute({ query: '背诵', limit: 3 }, EXEC) as any
  ok(bare.route.via === 'snapshot' && /mcpServerName 为空/.test(bare.route.note),
    '不挂宿主的默认实例只走快照，并说明原因', bare.route)
  ok(/^快照 v\d/.test(bare.route.dataVersion), `快照路径报出快照版本：${bare.route.dataVersion}`)

  type Call = { name: string; arguments: any; parent?: unknown; callId: unknown }
  function fakeTools(opts: { has: boolean; reply?: (c: Call) => any }) {
    const calls: Call[] = []
    const tools: ToolsLike = {
      get: (name) => (opts.has && name.startsWith('mcp__k12__') ? {} : undefined),
      execute: async (input) => {
        calls.push(input as Call)
        return opts.reply ? opts.reply(input as Call) : { isError: true, error: { message: '没有回复' } }
      },
    }
    return { tools, calls }
  }
  const TOKEN = Symbol('exec-token')
  const EXEC2 = { signal: new AbortController().signal, callId: 'call_1', rootCallId: 'call_1', token: TOKEN } as never
  const [id1, id2] = [SNAP.anchors[0]!.id, SNAP.anchors[1]!.id]
  const textBlock = (o: unknown) => ({ isError: false, value: { content: [{ type: 'text', text: JSON.stringify(o) }] } })

  // 挂着 MCP、返回正常
  const up = fakeTools({ has: true, reply: () => textBlock({
    version: '1.4', ranking: '⚠️ 只有字面粗召回，排序不可信',
    candidates: [
      { id: id1, grain: { warning: '覆盖 3 个年级' }, why: ['字面命中「汉字」'] },
      { id: 'ca_NEWER_THAN_SNAPSHOT' },
      { id: id2 },
    ],
  }) })
  const viaMcp = await makeFindCapability(makeMcpBridge(up.tools, 'k12'))
    .execute({ query: '汉字', discipline: '语文', stage: 'g2', limit: 5 }, EXEC2) as any
  ok(viaMcp.route.via === 'mcp' && viaMcp.route.tool === 'mcp__k12__search_anchors', '挂着 MCP 时经 MCP 检索', viaMcp.route)
  ok(viaMcp.route.dataVersion === '底座 v1.4', `报出底座现行版本：${viaMcp.route.dataVersion}`)
  ok(up.calls.length === 1, `一次检索只发一次子调用（实际 ${up.calls.length}）—— 不许为计数多调`)
  const c0 = up.calls[0]!
  ok(c0.arguments.text === '汉字' && c0.arguments.citableOnly === true && c0.arguments.discipline === '语文'
    && c0.arguments.stage === 'G2' && c0.arguments.limit === 5, 'MCP 参数：原文、只要可引用、学科、年级、条数', c0.arguments)
  ok(c0.parent === TOKEN, '子调用挂在本次执行下（parent = 本次 token），过宿主的审批与取消')
  ok(String(c0.callId).startsWith('call_1:'), `子调用 id 能对回父调用：${String(c0.callId)}`)
  ok(!('learner' in c0.arguments) && Object.keys(c0.arguments).every((k) =>
    ['text', 'discipline', 'stage', 'limit', 'citableOnly'].includes(k)), '发给底座的只有检索参数，不带任何档案字段')
  ok(viaMcp.returned === 2 && viaMcp.anchors[0].id === id1 && viaMcp.anchors[1].id === id2,
    '按 MCP 的顺序回表快照字段', viaMcp.anchors.map((a: any) => a.id))
  ok(viaMcp.anchors[0].grainWarning === '覆盖 3 个年级' && viaMcp.anchors[0].why.length === 1, '带上 MCP 的粒度警告与命中理由')
  ok(/1 条候选不在随包快照里/.test(viaMcp.route.note), '快照里没有的 ID 不编字段，如实报数', viaMcp.route.note)
  const viaText = (makeFindCapability(makeMcpBridge(up.tools, 'k12')).output.render as any)({}, viaMcp)[0].text as string
  ok(viaText.startsWith('［经底座 MCP · 底座 v1.4］'), `渲染抬头说明走了 MCP：${viaText.split('\n')[0]}`)
  const fcm = makeFindCapability(makeMcpBridge(up.tools, 'k12')) as any
  ok(fcm.presentResult({}, { content: [{ type: 'text', text: viaText }] }).title === '检索能力锚点（经底座 MCP）', '完成卡片标出「经底座 MCP」')

  // 没挂 MCP
  const none = fakeTools({ has: false })
  const noMcp = await makeFindCapability(makeMcpBridge(none.tools, 'k12')).execute({ query: '背诵', limit: 3 }, EXEC2) as any
  ok(noMcp.route.via === 'snapshot' && /宿主里没有 mcp__k12__search_anchors/.test(noMcp.route.note), '没挂 MCP 时退回快照并说明', noMcp.route.note)
  ok(noMcp.returned === 3 && none.calls.length === 0, '没挂就不调，结果与快照检索一致')
  ok(/不进底座的使用计数/.test(noMcp.route.note), '兜底时明说这次不会被底座计数')

  // MCP 调用失败 / 报错 / 形状不对 —— 都要退回快照而不是崩，也不许静默
  const fail = fakeTools({ has: true, reply: () => ({ isError: true, error: { message: '审批被拒' } }) })
  const r5 = await makeFindCapability(makeMcpBridge(fail.tools, 'k12')).execute({ query: '背诵' }, EXEC2) as any
  ok(r5.route.via === 'snapshot' && /审批被拒/.test(r5.route.note), 'MCP 子调用失败 → 快照，并带出失败原因', r5.route.note)
  const err = fakeTools({ has: true, reply: () => textBlock({ error: '映射器调用失败：python3 不在' }) })
  const r6 = await makeFindCapability(makeMcpBridge(err.tools, 'k12')).execute({ query: '背诵' }, EXEC2) as any
  ok(r6.route.via === 'snapshot' && /python3 不在/.test(r6.route.note), 'MCP 返回 error → 快照，并带出底座的报错', r6.route.note)
  const junk = fakeTools({ has: true, reply: () => ({ isError: false, value: { content: [{ type: 'image' }] } }) })
  const r7 = await makeFindCapability(makeMcpBridge(junk.tools, 'k12')).execute({ query: '背诵' }, EXEC2) as any
  ok(r7.route.via === 'snapshot' && /形状不认识/.test(r7.route.note), '返回形状不认识 → 快照', r7.route.note)

  // 纯列举没有 MCP 等价物：不调
  const list = fakeTools({ has: true, reply: () => textBlock({ candidates: [] }) })
  const r8 = await makeFindCapability(makeMcpBridge(list.tools, 'k12')).execute({ discipline: '语文', limit: 2 }, EXEC2) as any
  ok(r8.route.via === 'snapshot' && list.calls.length === 0, '没给 query 的列举不调 MCP', r8.route)

  // substrate_info 报告路由状态：只探测，绝不调用
  const probe = fakeTools({ has: true, reply: () => textBlock({}) })
  const info2 = await makeSubstrateInfo(makeMcpBridge(probe.tools, 'k12')).execute({}, EXEC2) as any
  ok(info2.queryRoute.mcpMounted === true && probe.calls.length === 0, 'substrate_info 探测到 MCP 但不调用它（报告状态不许被计数）')
  ok(info2.sourceVersion === (SNAP.sourceVersion ?? ''), `substrate_info 报出快照版本 ${info2.sourceVersion}`)
  const info3 = await makeSubstrateInfo(makeMcpBridge(none.tools, 'k12')).execute({}, EXEC2) as any
  ok(info3.queryRoute.mcpMounted === false && /全部查询走随包快照/.test(info3.queryRoute.note), 'substrate_info 如实报告 MCP 不可用')

  await throws(async () => makeMcpBridge(up.tools, 'bad name!'), 'serverName 不合法时配置期就报错', /mcpServerName 不合法/)

  // ── 7. 落盘内容 ───────────────────────────────────────────────
  console.log('\n【7】档案文件本身')
  const saved = JSON.parse(readFileSync(r1.profilePath, 'utf8'))
  ok(saved.subject === 'stu_TEST01', 'subject 正确')
  ok(saved.assertions.every((a: any) => a.schemaVersion === '0.1.0'), '断言都带 schemaVersion')
  ok(saved.assertions.every((a: any) => a.predicate === 'MASTERED'), 'predicate 统一')
  ok(saved.assertions.every((a: any) => ['proposed', 'confirmed'].includes(a.confidence)), 'confidence 取值合法')

} finally {
  rmSync(DIR, { recursive: true, force: true })
}

console.log(`\n${failed ? '✗' : '✓'} ${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
