/**
 * k12_substrate_info — 这个底座是什么、覆盖到哪、哪里靠不住。
 *
 * 存在的理由：模型手里一旦有个叫「K12 知识底座」的工具，很容易默认它覆盖全学科，
 * 然后拿这一百多条语文/英语清单锚点去回答数学问题，并且答得很像样。
 * 这个工具让边界成为可查的事实，而不是靠提示词嘱咐。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { load } from '../data.ts'

export const substrateInfo = defineTool({
  name: 'k12_substrate_info',
  description:
    '返回本底座的覆盖范围、数据来源、可信度分级与已知局限。' +
    '在向用户断言「课标要求什么」之前应先调用本工具，确认所问学科是否在覆盖范围内。',
  parameters: {},
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        standard: { type: 'string', required: true },
        sourceRepo: { type: 'string', required: true },
        sourceCommit: { type: 'string', required: true },
        anchorsUsable: { type: 'integer', required: true },
        anchorsPendingObjection: { type: 'integer', required: true, description: 'AI 裁定、无人签字的条数' },
        anchorsTotal: { type: 'integer', required: true },
        listItems: { type: 'integer', required: true },
        edges: { type: 'integer', required: true },
        disciplines: { type: 'array', required: true, items: { type: 'string' }, description: '有可用锚点的学科' },
        lists: {
          type: 'array', required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { id: { type: 'string', required: true }, kind: { type: 'string', required: true }, count: { type: 'integer', required: true } },
          },
        },
        limitations: { type: 'array', required: true, items: { type: 'string' } },
      },
    },
    render: (_args, value) => [{
      type: 'text',
      text: [
        `${value.standard}`,
        `可用锚点 ${value.anchorsUsable}（其中 ${value.anchorsPendingObjection} 条 AI 裁定待异议）/ 抽取总量 ${value.anchorsTotal}　清单条目 ${value.listItems}　依赖边 ${value.edges}`,
        `覆盖学科：${value.disciplines.join('、')}`,
        '',
        '清单：',
        ...value.lists.map((l) => `- ${l.id}　${l.count} 条　${l.kind}`),
        '',
        '局限：',
        ...value.limitations.map((s) => `- ${s}`),
      ].join('\n'),
    }],
  },
  presentCall: () => ({ card: 'generic', title: '查底座覆盖范围与已知局限', kind: 'read' }),

  async execute() {
    const snap = load()
    // 学科厚薄现算 —— 硬写的数字半年后一定是假的。
    // 这一句原本写着「义务教育 14 科均已覆盖」，而底座早就覆盖到高中 24 科了。
    const _c: Record<string, number> = {}
    for (const a of snap.anchors) _c[a.discipline] = (_c[a.discipline] ?? 0) + 1
    const byDisc = Object.entries(_c).sort((x, y) => y[1] - x[1])
    return {
      standard: snap.standard,
      sourceRepo: snap.sourceRepo,
      sourceCommit: snap.sourceCommit ?? '',
      anchorsUsable: snap.counts.anchorsUsable,
      anchorsPendingObjection: snap.counts.anchorsPendingObjection,
      anchorsTotal: snap.counts.anchorsTotal,
      listItems: snap.counts.listItems,
      edges: snap.counts.edges,
      disciplines: [...new Set(snap.anchors.map((a) => a.discipline))],
      lists: snap.listMeta.map((m) => ({ id: m.id, kind: m.kind ?? '', count: m.count })),
      limitations: [
        `全库从课标抽出 ${snap.counts.anchorsTotal} 条候选锚点，${snap.counts.anchorsUsable} 条对外开放。`,
        // **2026-08-20 改。** 原文说这些是「判定客观、无需教师复核」的 ——
        // 那个说法只对其中一小部分（字表词表那类数得清的）成立。
        // 底座把可引用线放宽到 ai-reviewed 之后，绝大多数是「AI 看过、没挑出毛病」，
        // **那不是判定客观，更不是教师签字**。说清楚成色是这个工具存在的理由。
        `其中 ${snap.counts.anchorsPendingObjection} 条是 AI 判过但**没有任何人签过字**的（pendingObjection=true），`
          + '引用时必须向用户说明。教师签字数目前是 0。',
        '「判定客观、无需人看」的只有字表/词表/背诵篇目那一类——字写对没有、篇背下来没有，数得清。',
        `覆盖 ${byDisc.length} 科（含高中），深浅差别很大：`
          + `最厚 ${byDisc.slice(0, 3).map(([d, n]) => `${d} ${n}`).join('、')}；`
          + `最薄 ${byDisc.slice(-3).map(([d, n]) => `${d} ${n}`).join('、')}。`
          + '查不到某条具体要求不代表课标没写，只代表它没能改写成有标准答案的可判定断言。',
        '课标里大量要求是「感受/体会/认同」这类，本质上无法二值判定，已在抽取阶段整批舍弃 —— 这是有意的，不是遗漏。',
        // **2026-08-20 改。** 原文说「只有 N 条依赖边，且均来自实测集合包含关系」——
        // 底座完成了边的语义重标（specs/001），现在每条边带类型和「不具备时的
        // 具体失败表现」，不再只有集合包含。但**没有一条经过人复核**。
        `可用锚点之间有 ${snap.counts.edges} 条依赖边，每条带类型（子动作／手段可绕／概念前提）`
          + '和不具备时的具体失败表现，可以用来向用户解释「为什么得先学这个」。',
        '但这些边**全部是模型提议、无人复核**，所以本底座仍然不自动排学习路径——'
          + '拿没人看过的边给一个具体孩子排顺序，就是把没验过的东西当验过的用。',
        '教材层（哪一课出现哪个知识点）因版权原因不在本数据内。',
        '学习者档案为本机数据，不随插件分发，也不上传。',
      ],
    }
  },
})
