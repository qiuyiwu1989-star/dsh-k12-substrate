# dsh-k12-substrate

[English](README.md) | 中文

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 接上一套**中国 K12 能力底座**：模型可以查课标能力锚点、查字表词表篇目、把某个孩子的掌握情况写进本机档案、算出识字量与下一步。

数据来自[教育部《义务教育课程标准（2022年版）》](https://github.com/qiuyiwu1989-star/k12-knowledge-substrate)。

## 先说清楚它不是什么

这一节放在最前面，因为**误以为它覆盖全学科，比不装它更糟**。

从课标抽出 1,958 条候选能力锚点，**只有 765 条**通过了「判定客观、无需教师复核」的门槛并随包分发：

| | 数量 |
|---|---|
| 课标切出的碎片 | 4,841 |
| 过可判定性闸 | 1,958 |
| AI 复审后存活 | 1,219 |
| **可写进孩子档案（本插件暴露的）** | **765** |

其中 146 条判定客观（字写对没有、篇背下来没有），另 619 条是 AI 带课标原文裁定的事实性知识、**尚无教师签字**。

**义务教育 14 科均已覆盖**，但深浅差别很大：语文 186、科学 126、数学 73，而地理 18、劳动 14。查不到某条具体要求，只代表它没能改写成有标准答案的可判定断言——课标里大量「感受/体会/认同」类要求本质上无法二值判定，已在抽取阶段整批舍弃，这是有意的。

同理，本插件**仍然不自动回答「先学什么后学什么」**。

2026-08-20 底座完成了先修边的语义重标：一千多条边各自带上了类型（`component` 子动作 / `instrument` 手段可绕 / `semantic` 概念前提）和**不具备时的具体可观察失败表现**——例如「面对 y=sin x 的坐标系，该学生反复翻书试图寻找一个公式来逐点计算坐标值，而不是利用五点作图法直接描出关键点」。这些通过 `k12_find_capability` 透出，模型解释「为什么得先学这个」时用得上。

**但这些边全部是模型提议、无人复核。** 所以插件不拿它们自动排路径——给一个具体孩子排学习顺序，等于把没验过的东西当验过的用，这和当初不肯用未复核锚点是同一条线。

## 安装

```bash
pnpm add dsh-k12-substrate
```

```bash
pnpm dsh web --patch ./node_modules/dsh-k12-substrate/cordis.patch.yml
```

或者在你自己的 `cordis.yml` 里插入：

```yaml
- insert:
    - id: k12-substrate
      name: 'dsh-k12-substrate'
      config:
        profileDir: ''      # 留空则用 ~/.dsh-k12-substrate/profiles/
        readOnly: false     # true 则只注册查询工具，不注册档案读写
```

## 五个工具

| 工具 | 做什么 |
|---|---|
| `k12_substrate_info` | 覆盖范围、数据来源、**已知局限**。断言「课标要求什么」之前应先调它 |
| `k12_find_capability` | 按学科/学段/关键词检索能力锚点，返回可判定的断言与判定依据 |
| `k12_lookup_item` | 查一个字/词/篇目在课标附录里的位置：哪张表、第几号、要求学段、认还是写 |
| `k12_record_mastery` | 把「这孩子会了什么」写进**本机**档案 |
| `k12_learner_progress` | 算识字量、词汇量、背诵篇数、各锚点完成度、下一步可学条目 |

后两个可以用 `readOnly: true` 关掉。

## 用起来什么样

```
你：帮我看看「灞」这个字，小学要求会写吗？

  → k12_lookup_item { item: "灞" }
  「灞」不在课标附录的任何清单里（已查 12 张表：常用字表 3500、基本字表 299、
   背诵篇目 135、英语二级/三级词汇等）。

你：那「口」呢？

  → k12_lookup_item { item: "口" }
  「口」命中 2 处：
  - 字表一　第 983 号　学段 G1-9　要求：写　→ 锚点 ca_5DS8mPj4
  - lst_hanzi-jiben-300　未编号　学段 G1-9　→ 锚点 ca_GyQEdbby

你：孩子（代号 stu_0001）今天听写，基本字表里的「口、山、巾」都写对了，记一下。

  → k12_record_mastery { learner: "stu_0001", anchorId: "ca_GyQEdbby",
                         items: ["口","山","巾"] }
  已记录 3 条（proposed）：能正确书写识字写字教学基本字表中的汉字　3/299（1%）
  （标记为待确认 —— 模型判定不等于孩子真的掌握，需教师或家长确认）
```

## 三条硬规矩

**1. 档案只在本机，且只回显计数。**
`k12_record_mastery` 写的是某个具体孩子会什么不会什么——未成年人的学习画像。它只落 `profileDir` 下的文件，默认 `~/.dsh-k12-substrate/profiles/`，不上传任何服务器。工具返回值也只给计数，不逐条列出掌握明细：**工具返回值会进模型上下文，进而可能被写进会话日志、被压缩、被发给模型提供方**。计数是产品必需的，逐字逐词的明细不是。

`learner` 会作为文件名，因此建议用不含真实姓名的代号（如 `stu_0001`）；插件会拒绝含路径穿越字符的取值。

**2. 模型判定一律 `proposed`。**
只有 `holder` 以 `teacher:` 或 `parent:` 开头时才记为 `confirmed`。模型说孩子会了不等于孩子会了，沉默更不算确认。`k12_learner_progress` 会把两者分开报。

**3. 只能引用可用锚点。**
断言指向一条没人复核过的锚点，等于用没验过的尺子量孩子。传了不在可用集合里的 ID 会直接报错。

## 开发

```bash
pnpm install
pnpm snapshot   # 从 ../os-k12-taxonomy 重建数据快照
pnpm verify     # typecheck + 75 条自测
pnpm build
```

自测（`scripts/smoke.ts`）不依赖 DSH 运行时，直接调 `execute()` 验真实数据、真实边界、真实落盘。它抓到过两个 typecheck 抓不到的问题：`required` 放在 `items` 指向的节点根上会在运行时抛 `UNSUPPORTED_SCHEMA`；以及去重键格式在三个文件里各写一遍、其中一处分隔符是字面 NUL 字节。

## 许可

代码 MIT；随包数据 ODbL v1.0 + CC BY-SA 4.0（与上游一致）。课标原文不随包分发，权利归中华人民共和国教育部。详见 [LICENSE](LICENSE)。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
