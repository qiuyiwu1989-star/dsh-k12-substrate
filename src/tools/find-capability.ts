/**
 * k12_find_capability — 按学科/学段/关键词检索能力锚点。
 *
 * 返回的每条锚点都带 `assessment`（照着问的那句话）和 `basis`
 * （凭什么不用等老师复核）。模型被追问「你怎么知道」时要能答出来。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { load, index, getAnchor, inStage, type Anchor } from '../data.ts'

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

export const findCapability = defineTool({
  name: 'k12_find_capability',
  description:
    '检索中国 K12 能力锚点（源自教育部《义务教育课程标准（2022年版）》）。' +
    `库中 ${N} 条可用锚点，其中 ${P} 条标注为「AI 裁定·待异议」——` +
    '那些是 AI 带课标原文裁定的，尚无教师签字。向用户陈述这类锚点时应说明这一点。' +
    '数学、物理等学科的锚点仍未开放，此工具查不到——查不到不等于课标里没有。',
  parameters: {
    query: { type: 'string', description: '关键词，匹配能力断言与对象。留空则返回全部（受 limit 限制）' },
    discipline: { type: 'string', description: '学科，如「语文」「英语」' },
    stage: { type: 'string', description: '学段 G1–G9，返回该学段适用的锚点' },
    limit: { type: 'integer', description: `返回上限，默认 20，最大 ${N}` },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        total: { type: 'integer', required: true, description: '匹配总数（可能大于返回数）' },
        returned: { type: 'integer', required: true },
        anchors: { type: 'array', required: true, items: anchorNode },
      },
    },
    render: (_args, value) => {
      if (value.returned === 0) {
        return [{ type: 'text', text: `没有匹配的锚点。库中仅 ${N} 条可用锚点，集中在语文识字/背诵与英语词汇。` }]
      }
      const lines = value.anchors.map((a) => {
        const stage = a.stageMin ? ` [${a.stageMin}–${a.stageMax}]` : ''
        const n = a.itemCount ? `　${a.itemCount} 条` : ''
        const p = a.pendingObjection ? '　[AI裁定·待异议]' : ''
        return `- ${a.id}${stage} ${a.discipline}｜${a.statement}${n}${p}`
      })
      const more = value.total > value.returned ? `\n（共 ${value.total} 条匹配，已显示 ${value.returned} 条）` : ''
      return [{ type: 'text', text: lines.join('\n') + more }]
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

  async execute(args) {
    const snap = load()
    const q = args.query?.trim()
    const limit = Math.min(Math.max(args.limit ?? 20, 1), N)

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

    return {
      total: hits.length,
      returned: Math.min(hits.length, limit),
      anchors: hits.slice(0, limit).map(project),
    }
  },
})
