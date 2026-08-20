# 架构文档

dsh-k12-substrate 是一个 DeepSeek Harness 插件，为中国 K12 教育提供 AI 能力底座。

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    DeepSeek Harness                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                 Cordis Plugin System                   │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │              dsh-k12-substrate                   │  │  │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐           │  │  │
│  │  │  │ Tool 1  │ │ Tool 2  │ │ Tool 3  │ ...       │  │  │
│  │  │  └────┬────┘ └────┬────┘ └────┬────┘           │  │  │
│  │  │       │           │           │                 │  │  │
│  │  │  ┌────┴───────────┴───────────┴────┐            │  │  │
│  │  │  │         Data Layer              │            │  │  │
│  │  │  │  ┌─────────────┐ ┌───────────┐  │            │  │  │
│  │  │  │  │  Snapshot   │ │  Profile  │  │            │  │  │
│  │  │  │  │  (read-only)│ │  (local)  │  │            │  │  │
│  │  │  │  └─────────────┘ └───────────┘  │            │  │  │
│  │  │  └─────────────────────────────────┘            │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 数据流

### 1. 数据源

```
教育部《义务教育课程标准（2022年版）》
    ↓
官方 PDF / 网页
    ↓
人工标注 + AI 辅助抽取
    ↓
os-k12-taxonomy（上游数据仓库）
    ↓
https://github.com/qiuyiwu1989-star/k12-knowledge-substrate
```

### 2. 数据处理

```
os-k12-taxonomy
    ↓
scripts/build-snapshot.mjs
    ↓
┌─────────────────────────────────────┐
│  数据清洗流程                        │
│  1. 候选锚点抽取（4,841 条）          │
│  2. 可判定性筛选（1,958 条）          │
│  3. AI 复审（1,219 条）              │
│  4. 人工抽检（765 条可用）            │
└─────────────────────────────────────┘
    ↓
data/substrate.json（1.2MB）
```

### 3. 运行时加载

```
data/substrate.json
    ↓
src/data.ts
    ↓
┌─────────────────────────────────────┐
│  索引构建                            │
│  - byId: Map<id, Anchor>            │
│  - byKey: Map<key, ListItem[]>      │
│  - prereqs: Map<id, Edge[]>         │
└─────────────────────────────────────┘
    ↓
工具调用时使用
```

## 核心模块

### 1. 数据层（src/data.ts）

**职责**：加载快照、构建索引、提供数据访问接口。

**关键接口**：
- `load()`：加载快照文件
- `index()`：构建索引（byId, byKey, prereqs）
- `getAnchor(id)`：获取锚点
- `inStage(anchor, stage)`：判断学段是否在范围内

**数据结构**：

```typescript
interface Snapshot {
  schemaVersion: string
  sourceCommit: string | null
  sourceRepo: string
  standard: string
  counts: {
    anchorsUsable: number      // 765
    anchorsPendingObjection: number
    anchorsTotal: number
    listItems: number          // 6,091
    edges: number              // 553
  }
  anchors: Anchor[]
  lists: Record<string, ListItem[]>
  listMeta: ListMeta[]
  edges: Edge[]
}
```

### 2. 档案层（src/profile.ts）

**职责**：管理学习者档案，确保数据安全。

**关键接口**：
- `read(dir, subject)`：读取档案
- `write(dir, profile)`：写入档案
- `masteredAnchors(profile)`：获取已掌握锚点集合
- `masteredItems(profile)`：获取已掌握清单条目集合
- `itemKey(listId, key)`：生成去重键

**安全设计**：
- 档案只存本机（默认 `~/.dsh-k12-substrate/profiles/`）
- 文件名使用学生代号，不含真实姓名
- 防止路径穿越攻击
- 工具返回值只给计数，不逐条列出明细

### 3. 工具层（src/tools/）

**职责**：实现 5 个 model tools。

#### k12_substrate_info

**功能**：介绍覆盖范围、数据来源、已知局限。

**使用场景**：
- 开始辅导前了解能力边界
- 回答"这个插件能做什么"
- 断言"课标要求什么"之前先调它

#### k12_find_capability

**功能**：按学科/学段/关键词检索能力锚点。

**参数**：
- `discipline`：学科（可选）
- `stage`：学段（可选）
- `keyword`：关键词（可选）

**返回**：可判定的断言与判定依据。

#### k12_lookup_item

**功能**：查一个字/词/篇目在课标附录里的位置。

**参数**：
- `item`：要查的字/词/篇目

**返回**：在哪张表、第几号、要求学段、认还是写。

#### k12_record_mastery

**功能**：记录学生掌握情况。

**参数**：
- `learner`：学生代号
- `anchorId`：锚点 ID
- `items`：具体条目（可选）
- `holder`：确认者（可选，默认 `ai:agent`）

**返回**：已掌握计数（不逐条列出明细）。

**安全设计**：
- AI 写入一律 `proposed`
- 只有 `teacher:` 或 `parent:` 开头的 holder 才记为 `confirmed`
- 沉默不算确认

#### k12_learner_progress

**功能**：查看学习进度。

**参数**：
- `learner`：学生代号

**返回**：识字量、词汇量、背诵篇数、各锚点完成度、下一步可学条目。

## 隐私设计

### 数据分层

```
L1: 课标数据（公开）
    - 能力锚点
    - 字表、词表、篇目表
    - 依赖关系
    - 随包分发，运行时只读

L2: 学习记录（本地）
    - 学生代号
    - 掌握情况
    - 时间戳
    - 只存本机，不上传

L3: 个人信息（不收集）
    - 真实姓名
    - 学校信息
    - 家庭信息
    - 完全不涉及
```

### 安全措施

1. **档案隔离**：每个学生一个文件，文件名是代号
2. **路径安全**：防止路径穿越攻击
3. **返回值脱敏**：工具返回值只给计数，不逐条列出明细
4. **确认机制**：AI 判定一律 `proposed`，需人工确认
5. **本地存储**：档案只存本机，不上传任何服务器

## 性能优化

### 快照打包

- 构建时生成 `substrate.json`（1.2MB）
- 运行时零网络请求
- 启动时一次性加载，后续查询 O(1)

### 索引优化

- `byId`：锚点 ID → 锚点对象（O(1) 查找）
- `byKey`：字/词/篇目 → 清单条目数组（O(1) 查找）
- `prereqs`：锚点 ID → 依赖边数组（O(1) 查找）

### 内存优化

- 快照加载后缓存，不重复解析
- 索引构建后缓存，不重复构建
- 档案按需加载，不预加载所有学生

## 扩展点

### 1. 添加新学科

1. 在 `os-k12-taxonomy` 中添加新学科数据
2. 运行 `pnpm snapshot` 重建快照
3. 运行 `pnpm verify` 验证

### 2. 添加新工具

1. 在 `src/tools/` 下创建新文件
2. 实现 `execute` 函数
3. 在 `src/index.ts` 中注册
4. 编写测试
5. 更新文档

### 3. 添加新数据源

1. 在 `scripts/build-snapshot.mjs` 中添加新数据源处理
2. 定义数据格式
3. 添加验证逻辑
4. 运行 `pnpm snapshot` 重建快照

### 4. 自定义评估方式

1. 在锚点中添加 `assessment` 字段
2. 在工具中实现评估逻辑
3. 设计判定标准

## 依赖关系

```
dsh-k12-substrate
├── @deepseek-ai/cordis (peer)
├── @deepseek-ai/dsh-tools (peer)
└── data/substrate.json (bundled)

上游数据源：
└── os-k12-taxonomy
    └── 教育部课程标准（2022年版）
```

## 构建流程

```
源代码（src/）
    ↓
tsdown（打包）
    ↓
lib/（CommonJS）
    ↓
tsc（类型声明）
    ↓
lib/types/（.d.ts）
    ↓
pnpm verify（验证）
    ↓
npm publish（发布）
```

## 测试策略

### 单元测试

- 测试每个工具的 `execute` 函数
- 测试数据加载和索引构建
- 测试档案读写

### 集成测试

- 测试工具之间的交互
- 测试数据流完整性
- 测试边界情况

### 自测（scripts/smoke.ts）

- 不依赖 DSH 运行时
- 直接调用 `execute()` 验真实数据
- 验真实边界、真实落盘
- 抓 typecheck 抓不到的问题

## 未来规划

### 短期（1-3 个月）

- 扩展数学、英语、科学的能力锚点
- 增加依赖图的深度
- 添加更多可判定断言类型

### 中期（3-6 个月）

- 支持高中课标
- 添加学习路径推荐
- 集成更多评估方式

### 长期（6-12 个月）

- 支持国际课程标准
- 添加自适应学习算法
- 构建教育知识图谱

## 参考资料

- [义务教育课程标准（2022年版）](http://www.moe.gov.cn/srcsite/A26/s8001/202204/W020220420582343214118.pdf)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [Cordis Plugin System](https://github.com/cordiverse/cordis)
- [os-k12-taxonomy](https://github.com/qiuyiwu1989-star/k12-knowledge-substrate)
