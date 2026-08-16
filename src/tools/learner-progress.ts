/**
 * k12_learner_progress — 从本机档案算出这孩子到哪了，以及下一步学什么。
 *
 * 关于「下一步」能给到什么程度，必须说实话：
 *
 * 可用锚点之间目前只有 2 条依赖边（实测的集合包含：基本字表 ⊂ 常用字表一、
 * 二级词汇 ⊂ 三级词汇）。所以这里的推荐只有两个合法来源：
 *   - 集合包含边 —— 先把小表吃完再上大表
 *   - 表内序号 —— 课标附录的表本身是有序的
 *
 * 跨学科的学习路径推荐**做不到**：那需要数学/物理那批 DAG 锚点，
 * 而它们的判定依赖教学判断，还没过复核。工具会在返回值里明说这一点，
 * 免得模型拿这点数据编出一条看起来很完整的学习路径。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { load, index, getAnchor } from '../data.ts'
import * as profile from '../profile.ts'

export function makeLearnerProgress(profileDir: string) {
  return defineTool({
    name: 'k12_learner_progress',
    description:
      '读取本机档案，汇总某学习者的识字量、英语词汇量、背诵篇数与各锚点完成度，' +
      '并给出下一步可学条目。' +
      '下一步的依据仅有两个：课标附录表的固有顺序，以及实测的集合包含关系（小表⊂大表）。' +
      '本工具不提供跨学科学习路径推荐——那需要尚未通过教师复核的锚点。',
    parameters: {
      learner: { type: 'string', required: true, description: '学习者代号' },
      suggestNext: { type: 'integer', description: '每条清单锚点建议多少个下一步条目，默认 10，0 表示不建议' },
      stage: {
        type: 'string',
        description:
          '孩子所在学段 G1-2 / G3-4 / G5-6 / G7-9。给了就按该学段的课标目标算完成度' +
          '（二年级孩子识字 386 该显示 386/1600，不是 386/3500）。不给则按整个义务教育的总量算',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          learner: { type: 'string', required: true },
          hasProfile: { type: 'boolean', required: true },
          totals: {
            type: 'object', required: true,
            additionalProperties: false,
            properties: {
              assertions: { type: 'integer', required: true },
              confirmed: { type: 'integer', required: true, description: '经教师/家长确认的条数' },
              proposed: { type: 'integer', required: true, description: 'AI 判定、待确认的条数' },
              hanzi: { type: 'integer', required: true, description: '识字量（去重后的汉字数）' },
              words: { type: 'integer', required: true, description: '英语词汇量' },
              recited: { type: 'integer', required: true, description: '已背诵篇数' },
            },
          },
          byAnchor: {
            type: 'array', required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                anchorId: { type: 'string', required: true },
                statement: { type: 'string', required: true },
                done: { type: 'integer', required: true },
                total: { type: 'integer', required: true, description: '分母。给了 stage 就是该学段的课标目标，否则是清单总条数' },
                totalBasis: { type: 'string', required: true, description: '分母是什么：「第一学段目标」或「清单总量」' },
                percent: { type: 'integer', required: true },
              },
            },
          },
          nextUp: {
            type: 'array', required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                anchorId: { type: 'string', required: true },
                statement: { type: 'string', required: true },
                basis: { type: 'string', required: true, description: '推荐依据：list-order 或 set-containment' },
                items: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
          limitation: { type: 'string', required: true, description: '本次推荐能力的边界，必须如实转述给用户' },
        },
      },
      render: (_args, value) => {
        if (!value.hasProfile) {
          return [{ type: 'text', text: `${value.learner} 还没有档案记录。先用 k12_record_mastery 写入。` }]
        }
        const t = value.totals
        const head = [
          `${value.learner}　识字 ${t.hanzi} 字　英语词汇 ${t.words}　背诵 ${t.recited} 篇`,
          `记录 ${t.assertions} 条：教师/家长确认 ${t.confirmed}，AI 判定待确认 ${t.proposed}`,
        ]
        const rows = value.byAnchor.map((a) =>
          a.total
            ? `- ${a.statement}　${a.done}/${a.total}（${a.percent}%，分母=${a.totalBasis}）`
            : `- ${a.statement}　已掌握`,
        )
        const next = value.nextUp.length
          ? ['', '下一步可学：', ...value.nextUp.map((n) =>
              `- ${n.statement}（依据 ${n.basis}）：${n.items.slice(0, 12).join('　')}`)]
          : []
        return [{ type: 'text', text: [...head, '', ...rows, ...next, '', value.limitation].join('\n') }]
      },
    },
    presentCall: (args) => ({
      card: 'generic', title: `汇总 ${args.learner} 的学习进度`, kind: 'read',
    }),
    presentResult: (_args, result) => {
      const text = result.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      return { card: 'generic', title: text.split('\n')[0] ?? '进度' }
    },

    async execute(args) {
      const p = profile.read(profileDir, args.learner)
      const limit = Math.max(args.suggestNext ?? 10, 0)
      const snap = load()

      if (!p.assertions.length) {
        return {
          learner: p.subject,
          hasProfile: false,
          totals: { assertions: 0, confirmed: 0, proposed: 0, hanzi: 0, words: 0, recited: 0 },
          byAnchor: [],
          nextUp: [],
          limitation: '尚无档案数据。',
        }
      }

      // ── 汇总 ────────────────────────────────────────────────
      const hanzi = new Set<string>()
      const words = new Set<string>()
      let recited = 0
      let confirmed = 0
      for (const a of p.assertions) {
        if (a.confidence === 'confirmed') confirmed += 1
        const anchor = getAnchor(a.anchorId)
        if (!anchor) continue
        if (a.listRef) {
          const kind = snap.lists[a.listRef.listId]?.[0]?.n
          if (kind === 'HANZI') hanzi.add(a.listRef.key)
          else if (kind === 'WORD') words.add(a.listRef.key)
          else if (kind === 'RECITE') recited += 1
        } else if (anchor.verb === '背诵') recited += 1
      }

      // ── 各锚点完成度 ────────────────────────────────────────
      const done = new Map<string, number>()
      for (const a of p.assertions) done.set(a.anchorId, (done.get(a.anchorId) ?? 0) + 1)
      const stage = args.stage?.trim()
      const byAnchor = [...done.entries()]
        .map(([id, n]) => {
          const anchor = getAnchor(id)
          // 按学段取分母。课标给了每个学段的累计目标量，用整表总量当分母
          // 对低学段孩子毫无意义 —— 二年级看到 386/3500 只会觉得自己不行。
          const hit = stage
            ? (anchor?.stageTargets ?? []).find((t) => t.stage === stage)
            : undefined
          const total = hit ? hit.target : (anchor?.itemCount ?? 0)
          return {
            anchorId: id,
            statement: anchor?.statement ?? '(锚点已不在可用集合)',
            done: n,
            total,
            totalBasis: hit ? `${hit.band}目标` : '清单总量',
            percent: total ? Math.round((n / total) * 100) : 0,
          }
        })
        .sort((a, b) => b.done - a.done)

      // ── 下一步 ──────────────────────────────────────────────
      const mastered = profile.masteredItems(p)
      const nextUp: { anchorId: string; statement: string; basis: string; items: string[] }[] = []
      if (limit > 0) {
        const { prereqs } = index()
        for (const row of byAnchor) {
          const anchor = getAnchor(row.anchorId)
          if (!anchor || !row.total || row.done >= row.total) continue

          // 集合包含：若本表是某张大表的子集，且本表还没吃完，先吃本表
          const containedIn = prereqs.get(row.anchorId)?.length ?? 0
          const basis = containedIn ? 'set-containment' : 'list-order'

          const items: string[] = []
          for (const [listId, list] of Object.entries(snap.lists)) {
            if (!list.some((x) => x.a.includes(anchor.id))) continue
            for (const it of list) {
              if (!it.a.includes(anchor.id)) continue
              if (mastered.has(profile.itemKey(listId, it.k))) continue
              items.push(it.k)
              if (items.length >= limit) break
            }
            if (items.length >= limit) break
          }
          if (items.length) nextUp.push({ anchorId: anchor.id, statement: anchor.statement, basis, items })
        }
      }

      return {
        learner: p.subject,
        hasProfile: true,
        totals: {
          assertions: p.assertions.length,
          confirmed,
          proposed: p.assertions.length - confirmed,
          hanzi: hanzi.size,
          words: words.size,
          recited,
        },
        byAnchor,
        nextUp: nextUp.slice(0, 8),
        limitation:
          '说明：下一步建议仅依据课标附录表的固有顺序与实测集合包含关系。' +
          '本底座目前不支持跨学科学习路径推荐——数学、物理等学科的能力锚点判定依赖教学判断，' +
          '尚未通过教师复核，未纳入可用集合。请不要据此推断这些学科的学习顺序。',
      }
    },
  })
}
