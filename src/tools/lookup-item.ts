/**
 * k12_lookup_item — 查一个字/词/篇目在课标清单里的位置。
 *
 * 这是产品最常问的一问：「『灞』这个字，几年级要求会写？在不在 3500 字表里？」
 * 答案来自课标附录原表，序号经过编号连续性机械校验，不是模型记忆。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { index, load } from '../data.ts'

export const lookupItem = defineTool({
  name: 'k12_lookup_item',
  description:
    '查一个汉字、英语单词或背诵篇目在教育部课标附录清单中的位置：属于哪张表、表内第几号、' +
    '要求学段、是「认」还是「写」，以及挂在哪条能力锚点上。' +
    '数据来自课标附录原表，序号经编号连续性机械校验。查不到即该条目不在课标清单内。',
  parameters: {
    item: { type: 'string', required: true, description: '要查的单个汉字、英语单词，或背诵篇目标题' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        item: { type: 'string', required: true },
        found: { type: 'boolean', required: true },
        matches: {
          type: 'array', required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              listId: { type: 'string', required: true },
              table: { type: 'string', required: true, description: '表名，如「字表一」「字表二」' },
              seq: { type: 'integer', required: true, description: '表内序号，0 表示原表未编号' },
              stage: { type: 'string', required: true },
              tags: { type: 'array', required: true, items: { type: 'string' }, description: '如「写」「认」' },
              anchorIds: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
        },
      },
    },
    render: (args, value) => {
      if (!value.found) {
        return [{
          type: 'text',
          text: `「${args.item}」不在课标附录的任何清单里（已查 8 张表：常用字表 3500、基本字表 299、背诵篇目 135、英语二级/三级词汇等）。`,
        }]
      }
      const lines = value.matches.map((m) => {
        const seq = m.seq ? `第 ${m.seq} 号` : '未编号'
        const tags = m.tags.length ? `　要求：${m.tags.join('/')}` : ''
        return `- ${m.table || m.listId}　${seq}　学段 ${m.stage || '未标'}${tags}　→ 锚点 ${m.anchorIds.join(', ') || '（未挂）'}`
      })
      return [{ type: 'text', text: `「${args.item}」命中 ${value.matches.length} 处：\n${lines.join('\n')}` }]
    },
  },
  async execute(args) {
    const key = args.item.trim()
    if (!key) throw new Error('item 不能为空')

    const { byKey } = index()
    const hits = byKey.get(key) ?? []

    // 背诵篇目允许标题部分匹配 —— 用户常写《静夜思》而库里是「静夜思（李白）」
    let matches = hits
    if (!matches.length) {
      const bare = key.replace(/[《》〈〉""'']/g, '')
      const snap = load()
      matches = (snap.lists['lst_recite-yiwu-135'] ?? []).filter(
        (x) => x.k === bare || x.k.startsWith(`${bare}（`) || x.k.includes(bare),
      )
    }

    return {
      item: key,
      found: matches.length > 0,
      matches: matches.map((m) => ({
        listId: m.l,
        table: String((m.m as { table?: string } | null)?.table ?? ''),
        seq: m.s ?? 0,
        stage: m.g ?? '',
        tags: m.t,
        anchorIds: m.a,
      })),
    }
  },
})
