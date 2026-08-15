/**
 * k12_record_mastery — 把「这孩子会了什么」写进本机档案。
 *
 * 三条硬规矩，都不是可选项：
 *
 *   1. **只能引用 usable 锚点。** 断言指向一条没人复核过的锚点，等于用没验过的尺子
 *      量孩子。上游 profile_demo.py 守这条，这里也守。
 *   2. **AI 写入一律 proposed。** 只有 holder 以 `teacher:` / `parent:` 开头才算
 *      confirmed —— 模型说孩子会了，不等于孩子会了。沉默更不算确认。
 *   3. **落盘只落本机，回显只回显计数。** 见 profile.ts 顶部注释。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { getAnchor, load } from '../data.ts'
import * as profile from '../profile.ts'
import type { Assertion } from '../profile.ts'

let counter = 0
function nextId(): string {
  counter += 1
  return `as_${Date.now().toString(36)}${counter.toString(36).padStart(3, '0')}`
}

export function makeRecordMastery(profileDir: string) {
  return defineTool({
    name: 'k12_record_mastery',
    description:
      '记录某个学习者已掌握某条能力锚点（可细到具体的字/词/篇目）。' +
      '数据只写入本机档案文件，不上传任何服务器。' +
      '模型写入的记录一律标记为 proposed（待确认）；只有 holder 以 teacher: 或 parent: 开头时才记为 confirmed。' +
      '只能引用 k12_find_capability 返回的锚点 ID。',
    parameters: {
      learner: {
        type: 'string',
        required: true,
        description: '学习者代号。建议用不含真实姓名的代号（如 stu_0001），因为它会作为本机文件名',
      },
      anchorId: { type: 'string', required: true, description: '能力锚点 ID，来自 k12_find_capability' },
      items: {
        type: 'array',
        items: { type: 'string' },
        description: '清单类锚点下具体掌握的条目（字/词/篇目）。非清单类锚点留空',
      },
      holder: {
        type: 'string',
        description: '判定人。teacher:<名> / parent:<名> 记为 confirmed；其余（默认 ai:dsh）记为 proposed',
      },
      sourceApp: { type: 'string', description: '来源应用标识，默认 dsh' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          learner: { type: 'string', required: true },
          anchorId: { type: 'string', required: true },
          statement: { type: 'string', required: true },
          recorded: { type: 'integer', required: true, description: '本次新写入的断言条数' },
          skippedDuplicate: { type: 'integer', required: true, description: '已记录过、本次跳过的条数' },
          notInList: { type: 'array', required: true, items: { type: 'string' }, description: '不在该锚点清单内、被拒绝的条目' },
          confidence: { type: 'string', required: true },
          totalForAnchor: { type: 'integer', required: true, description: '该锚点下累计已掌握条数' },
          anchorItemCount: { type: 'integer', required: true, description: '该锚点清单总条数，0 表示非清单类' },
          profilePath: { type: 'string', required: true, description: '本机档案文件路径' },
        },
      },
      render: (_args, value) => {
        const pct = value.anchorItemCount
          ? `　${value.totalForAnchor}/${value.anchorItemCount}（${Math.round((value.totalForAnchor / value.anchorItemCount) * 100)}%）`
          : ''
        const parts = [
          `已记录 ${value.recorded} 条（${value.confidence}）：${value.statement}${pct}`,
        ]
        if (value.skippedDuplicate) parts.push(`跳过重复 ${value.skippedDuplicate} 条`)
        if (value.notInList.length) {
          parts.push(`以下条目不在该锚点的清单内，未记录：${value.notInList.slice(0, 10).join('、')}`)
        }
        if (value.confidence === 'proposed') {
          parts.push('（标记为待确认 —— 模型判定不等于孩子真的掌握，需教师或家长确认）')
        }
        return [{ type: 'text', text: parts.join('\n') }]
      },
    },
    // 卡片同样守隐私不变量：只显条数，不显具体哪些字/词。
    // 卡片会被持久化进会话日志并在回放时重现，比工具返回值活得更久。
    presentCall: (args) => ({
      card: 'generic',
      title: args.items?.length
        ? `记录 ${args.learner} 掌握 ${args.items.length} 个条目`
        : `记录 ${args.learner} 掌握一条能力`,
      kind: 'edit',
    }),
    presentResult: (_args, result) => {
      const text = result.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      return { card: 'generic', title: text.split('\n')[0] ?? '已记录' }
    },

    async execute(args) {
      const anchor = getAnchor(args.anchorId)
      if (!anchor) {
        throw new Error(
          `锚点 ${args.anchorId} 不在可用集合内。档案只能引用经确认的锚点（当前 ${load().counts.anchorsUsable} 条）；` +
          `先用 k12_find_capability 查到合法 ID。`,
        )
      }

      const dir = profileDir
      const p = profile.read(dir, args.learner)
      const already = profile.masteredItems(p)
      const holder = args.holder?.trim() || 'ai:dsh'
      const confidence: Assertion['confidence'] =
        /^(teacher|parent):/.test(holder) ? 'confirmed' : 'proposed'

      // 该锚点挂了哪些清单条目 —— 写进来的条目必须真的在表里
      const snap = load()
      const owned = new Map<string, string>()   // key → listId
      for (const [listId, items] of Object.entries(snap.lists)) {
        for (const it of items) {
          if (it.a.includes(anchor.id)) owned.set(it.k, listId)
        }
      }

      const today = new Date().toISOString().slice(0, 10)
      const mk = (listRef: Assertion['listRef']): Assertion => ({
        assertionId: nextId(),
        subject: profile.safeSubject(args.learner),
        predicate: 'MASTERED',
        anchorId: anchor.id,
        listRef,
        level: 1,
        validFrom: today,
        holder,
        confidence,
        evidence: [`${args.sourceApp?.trim() || 'dsh'}:${today}`],
        sourceApp: args.sourceApp?.trim() || 'dsh',
        schemaVersion: '0.1.0',
      })

      const notInList: string[] = []
      let recorded = 0
      let skipped = 0
      const items = (args.items ?? []).map((s) => s.trim()).filter(Boolean)

      if (items.length) {
        for (const key of items) {
          const listId = owned.get(key)
          if (!listId) { notInList.push(key); continue }
          if (already.has(profile.itemKey(listId, key))) { skipped += 1; continue }
          p.assertions.push(mk({ listId, key }))
          already.add(profile.itemKey(listId, key))
          recorded += 1
        }
      } else {
        // 非清单类，或整条锚点级掌握
        const existing = p.assertions.some((a) => a.anchorId === anchor.id && !a.listRef)
        if (existing) skipped += 1
        else { p.assertions.push(mk(null)); recorded += 1 }
      }

      const path = profile.write(dir, p)
      const totalForAnchor = p.assertions.filter((a) => a.anchorId === anchor.id).length

      return {
        learner: p.subject,
        anchorId: anchor.id,
        statement: anchor.statement,
        recorded,
        skippedDuplicate: skipped,
        notInList,
        confidence,
        totalForAnchor,
        anchorItemCount: anchor.itemCount ?? 0,
        profilePath: path,
      }
    },
  })
}
