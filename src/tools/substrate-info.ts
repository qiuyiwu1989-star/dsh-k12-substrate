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
        `全库从课标抽出 ${snap.counts.anchorsTotal} 条候选锚点，仅 ${snap.counts.anchorsUsable} 条通过「判定客观、无需教师复核」的门槛并对外开放。`,
        '开放的锚点集中在语文识字/写字/背诵与英语词汇——这些能力的对错是客观的（字写对没有、篇背下来没有）。',
        '义务教育 14 科均已覆盖，但深浅差别很大：语文/科学/数学较厚，地理/劳动较薄。查不到某条具体要求不代表课标没写，只代表它没能改写成有标准答案的可判定断言。',
        '课标里大量要求是「感受/体会/认同」这类，本质上无法二值判定，已在抽取阶段整批舍弃 —— 这是有意的，不是遗漏。',
        `可用锚点之间只有 ${snap.counts.edges} 条依赖边，且均来自实测集合包含关系，不是学习路径。本底座目前不能回答「先学什么后学什么」。`,
        '教材层（哪一课出现哪个知识点）因版权原因不在本数据内。',
        '学习者档案为本机数据，不随插件分发，也不上传。',
      ],
    }
  },
})
