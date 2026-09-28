# 检索经底座 MCP：怎么接、计什么、不计什么

## 为什么要接

底座（os-k12-taxonomy）有个只读的 MCP server（`mcp/server.mjs`），旁边有个调用计数器
（`scripts/usage.mjs`）：只记「哪条锚点被碰过几次」，不记查询内容，也不联网。
「计数第一次变成非零」是底座项目唯一的验收标准。

本插件是底座的第一个消费方，但它读的是随包快照（`data/substrate.json`），
快照上的查询永远进不了计数器。所以要让插件的检索改走 MCP。

## DSH 能不能调 MCP：能，走官方桥

依据（2026-09-28 查，本机 DSH `0.1.0-rc.8`，官方仓库 `deepseek-ai/deepseek-harness@21638c5`）：

1. **官方 MCP 客户端插件 `@deepseek-ai/dsh-mcp-client`**（`packages/mcp/mcp-client`）。
   README 原话：连一个 MCP server，把它的工具注册到 `ctx.tools`，模型看到的名字是
   `mcp__<serverName>__<rawName>`。一个 patch 行连一个 server，支持 `stdio` 和
   `streamable-http`。本机装的 `@deepseek-ai/dsh@0.1.0-rc.8` 已经把它列为依赖，不用另装。
2. **插件能在工具里嵌套调别的已注册工具**：`ToolRuntime.execute(exec: ToolExecutionInput)`
   是公开方法（`@deepseek-ai/dsh-tools` 的 `lib/types/index.d.ts`），
   `ToolExecutionInput.parent` 用来挂父调用的 token。官方 `run_code` 桥
   （`packages/core/tools/src/ptc.ts`）就是这么写的：`parent: exec.token`。
   rc.6（本仓库开发依赖）和 rc.8（本机宿主）这两个方法签名一致。

所以本插件**不自己起子进程、不手写 JSON-RPC**：MCP 连接归官方桥管（重连、超时、环境变量
脱敏都是它的），插件只在执行时按名字找 `mcp__k12__search_anchors`，用 `ctx.tools.execute()`
嵌套调用。子调用照样过宿主的审批、超时与取消。

## 哪些查询走 MCP

| 工具 | 走哪条路 | 为什么 |
|---|---|---|
| `k12_find_capability`（带 `query`） | **优先 MCP** `search_anchors`，`citableOnly: true`；不可用则快照 | 这是真正的「查询」。底座的检索算法只在 `tools/mapper.py` 里有一份，走 MCP 就是用那一份，而不是插件里的字面包含 |
| `k12_find_capability`（不带 `query`） | 快照 | MCP 的 `search_anchors` 必须有检索文本，没有等价的列举工具 |
| `k12_lookup_item` | 快照 | MCP 不暴露字表/词表/篇目清单 |
| `k12_record_mastery` / `k12_learner_progress` | 快照 + 本机档案 | 档案是 L3 数据，一个字都不发给底座 |
| `k12_substrate_info` | 快照；**只探测** MCP 在不在，不调用 | 报告状态不许顺手调一次 MCP —— 那一次会被当成真实使用计数 |

走 MCP 的结果按 MCP 给的顺序回表快照字段，另外带上 MCP 的粒度警告（`grainWarning`）与命中理由（`why`）。
MCP 返回了快照里没有的 ID（底座比快照新）时，不编字段，只在 `route.note` 里报数。

## 题目和课堂语言：传 `deep: true`

底座的检索默认是字面匹配。课标术语能找到，题目和课堂语言大多找不到 ——
「芳芳看了 90 页还剩多少」和「能计算两位数减两位数」几乎没有共同的字。
`deep: true` 会让底座先把内容改写成课标说法再检索，再由模型从候选里挑（两次模型调用，慢几秒）。
底座的 100 道真题基准（`reports/mapping-bench.md`）：第一名命中 27% → 61%，前三 75%。

要生效，**挂底座 MCP 的那个进程**得有模型密钥：`LLM_BASE` / `LLM_KEY` / `LLM_MODEL`
（火山方舟这类只有一个 OpenAI 兼容端点的，再加 `LLM_ENDPOINT=/chat/completions`）。
没配时底座退回字面匹配，`route.note` 里的排序说明会写「要了 deep 但没走成」。
走快照时 `deep` 不生效。

## 走哪条路，如实说

`k12_find_capability` 的返回值多了一个 `route`：

```
via          mcp | snapshot
tool         走 MCP 时是 mcp__k12__search_anchors，否则空串
dataVersion  「底座 v1.4」或「快照 v1.4」
note         为什么走这条路；走快照时写明是没配、没连上、被拒还是返回不对，
             并明说「这次不进底座的使用计数」
```

渲染给模型的文本第一行是 `［经底座 MCP · 底座 v1.4］…` 或 `［走随包快照 · 快照 v1.4］…`，
完成卡片的标题是「检索能力锚点（经底座 MCP）」或「（走随包快照）」。
不许静默回落：模型和用户都得知道这次结果有没有经过底座现行数据。

## 怎么挂上

```bash
K12_TAXONOMY_ROOT=/path/to/os-k12-taxonomy \
  dsh web --patch ./examples/mcp/cordis.patch.yml --patch ./cordis.patch.yml
```

`examples/mcp/cordis.patch.yml` 就是一行官方 MCP 桥的配置（`serverName: k12`，stdio，
`node <taxonomy>/mcp/server.mjs`）。需要本机有 taxonomy 的 checkout 和 `python3`。
插件配置 `mcpServerName` 默认 `k12`，要和那一行的 `serverName` 一致；设成空串即关掉 MCP 路由。

没有放进插件自带的 `cordis.patch.yml`：那一行必须写本机路径，而装插件的人多数没有 taxonomy
的 checkout —— 默认塞进去只会让每个人启动时多一条连接失败的报错。

## 计数的规矩

- **一次检索只发一次子调用**，就是取数据的那一次。不许为了让计数器动而多调（自测有断言守着）。
- **自测一律用假的 `ctx.tools`**，不起真的底座 server。底座的计数器被自测污染过一次
  （读数 112、真实调用 0）。不挂宿主的默认实例（`findCapability` / `substrateInfo`）
  MCP 路由是关着的，直接 import 调用碰不到计数器。
- **发给底座的只有检索参数**（`text` / `discipline` / `stage` / `limit` / `citableOnly`），
  不带学习者代号，不带档案里的任何东西。`text` 是模型给的检索文本，底座那边不记它 ——
  `usage.mjs` 的 `record(ids)` 签名只收锚点 ID。
- 要在真实组合里彩排又不想计数：给跑 DSH 的进程设 `K12_USAGE=0`（官方桥不会脱敏这个名字，
  会传给 server）。真实使用不要设。

## 首次接通的记录

2026-09-28 本机真实组合：DSH rc.8 的 `ToolRuntime` + 官方 `dsh-mcp-client` rc.8（stdio）
+ 底座 `mcp/server.mjs`（v1.4）+ 本插件 `lib/index.js`。

- 彩排（`K12_USAGE=0`）：`route.via = mcp`，`var/usage.json` 未生成。
- 正式一次：`k12_find_capability({ query: "认识常用汉字", discipline: "语文", limit: 1 })`，
  `route.via = mcp`，返回 `ca_mpRyDDzf`；`var/usage.json` 从不存在变为
  `ca_mpRyDDzf: hits 1`（计数器按 UTC 记日期，写的是 `2026-09-27`）。

**这 1 次是接通验证，不是真实用户使用。** 读计数的时候把它减掉。

## 没做、做不到的

- **没有经过模型的端到端跑**（`dsh --profile headless "…"`）：那要在本机 `~/.dsh` 下初始化一个
  headless profile，而且模型会不会调、调几次不可控，会往计数器里多写不可控的自家流量。
  上面那次是绕过模型、直接 `ctx.tools.execute()` 走的同一套宿主组件。
- **没有 GitHub 分发下的从零安装验证**。
- `k12_record_mastery` 不走 MCP。「这条锚点被写进了某个孩子的档案」其实是最强的使用信号，
  但为它单独调一次 MCP 只是为了计数 —— 要不要做、怎么做不算刷量，得户主定。
