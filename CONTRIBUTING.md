# 贡献指南

感谢你对 dsh-k12-substrate 的兴趣！这个项目的目标是为中国 K12 教育提供一个可靠的 AI 能力底座。

## 如何贡献

### 1. 报告问题

如果你发现了 bug 或有功能建议，请在 [GitHub Issues](https://github.com/qiuyiwu1989-star/dsh-k12-substrate/issues) 提交。

**Bug 报告模板**：
```
## 问题描述
简要描述问题

## 复现步骤
1. 执行 ...
2. 调用 ...
3. 看到错误 ...

## 期望行为
你期望发生什么

## 实际行为
实际发生了什么

## 环境信息
- Node.js 版本：
- pnpm 版本：
- DSH 版本：
- 操作系统：
```

### 2. 贡献代码

#### 开发环境设置

```bash
# 克隆仓库
git clone https://github.com/qiuyiwu1989-star/dsh-k12-substrate.git
cd dsh-k12-substrate

# 安装依赖
pnpm install

# 运行测试
pnpm test

# 类型检查
pnpm typecheck

# 构建
pnpm build
```

#### 代码规范

- 使用 TypeScript
- 遵循现有代码风格
- 所有新功能必须有测试
- 提交前运行 `pnpm verify`（typecheck + tests）

#### 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
feat: 添加新功能
fix: 修复 bug
docs: 更新文档
style: 代码格式调整
refactor: 重构
test: 添加测试
chore: 构建/工具变更
```

### 3. 贡献数据

#### 添加新的能力锚点

如果你发现课标中有"可判定"的能力锚点被遗漏了，欢迎贡献！

**可判定的标准**：
- 有明确的判定标准（对/错、会/不会）
- 不需要教师主观判断
- 可以通过客观测试验证

**贡献流程**：

1. Fork 仓库
2. 在 `data/` 目录下创建新的数据文件
3. 遵循现有数据格式（见下方）
4. 提交 PR，说明数据来源和判定标准

**数据格式**：

```json
{
  "id": "ca_xxx",
  "discipline": "语文",
  "track": "LIST",
  "strand": "识字写字",
  "statement": "能正确书写常用字表一中的汉字",
  "verb": "书写",
  "object": "常用字表一中的汉字",
  "stage": { "min": "G1", "max": "G9" },
  "assessment": "听写测试",
  "evidence": ["课标原文第 X 页"],
  "basis": ["义务教育语文课程标准（2022年版）"],
  "source": "https://...",
  "itemCount": 950,
  "reviewStatus": "auto-confirmed",
  "humanConfirmed": false,
  "pendingObjection": false
}
```

#### 添加新的清单条目

如果你发现字表、词表、篇目表有遗漏，欢迎贡献！

**清单类型**：
- `HANZI`：汉字
- `WORD`：词语
- `RECITE`：背诵篇目

**数据格式**：

```json
{
  "l": "lst_hanzi-changyong-950",
  "k": "口",
  "n": "HANZI",
  "s": 983,
  "g": "G1-9",
  "t": ["字表一", "写"],
  "a": ["ca_5DS8mPj4"],
  "m": null
}
```

#### 数据来源要求

- 必须来自官方文件（教育部课程标准、教学大纲等）
- 必须注明来源和页码
- 必须是公开可查的资料

### 4. 贡献文档

- 修正错别字
- 补充示例
- 翻译（当前支持中英文）
- 改进教程

## 开发指南

### 项目结构

```
dsh-k12-substrate/
├── src/                    # 源代码
│   ├── index.ts           # 插件入口
│   ├── data.ts            # 数据加载和索引
│   ├── profile.ts         # 学习者档案
│   └── tools/             # 工具实现
├── data/                   # 数据快照
│   └── substrate.json     # 构建时生成
├── scripts/                # 构建脚本
│   ├── build-snapshot.mjs # 从源数据生成快照
│   └── smoke.ts           # 自测脚本
├── examples/               # 示例
│   └── presets/           # Agent preset 示例
├── docs/                   # 文档
└── tests/                  # 测试（未来）
```

### 数据流

```
课标原文
    ↓
os-k12-taxonomy（上游仓库）
    ↓
scripts/build-snapshot.mjs
    ↓
data/substrate.json（随包分发）
    ↓
src/data.ts（运行时加载）
    ↓
src/tools/*.ts（工具实现）
```

### 添加新工具

1. 在 `src/tools/` 下创建新文件
2. 实现工具的 `execute` 函数
3. 在 `src/index.ts` 中注册工具
4. 添加到 `cordis.patch.yml`（如果需要配置）
5. 编写测试
6. 更新文档

### 测试

```bash
# 运行所有测试
pnpm test

# 运行特定测试
node --experimental-strip-types scripts/smoke.ts
```

测试不依赖 DSH 运行时，直接调用 `execute()` 验真实数据、真实边界、真实落盘。

### 构建

```bash
# 构建
pnpm build

# 验证（typecheck + tests）
pnpm verify

# 发布前验证
pnpm prepublishOnly
```

## 数据规范

### 锚点（Anchor）

锚点是课标中"可判定"的能力要求。

**必需字段**：
- `id`：唯一标识符，格式 `ca_xxx`
- `discipline`：学科名称
- `track`：类型（DAG/LIST/MATRIX）
- `statement`：能力陈述
- `verb`：动词（书写、背诵、计算等）
- `object`：对象（汉字、诗词、数字等）

**可选字段**：
- `strand`：领域（识字写字、阅读、写作等）
- `stage`：学段范围 `{ min: "G1", max: "G9" }`
- `assessment`：评估方式
- `evidence`：证据来源
- `basis`：依据文件
- `source`：原文链接
- `itemCount`：清单条目数量
- `stageTargets`：分阶段目标

### 清单条目（ListItem）

清单条目是字表、词表、篇目表中的具体条目。

**字段说明**：
- `l`：清单 ID，格式 `lst_xxx`
- `k`：条目内容（字、词、篇目名）
- `n`：类型（HANZI/WORD/RECITE）
- `s`：表内序号（可选）
- `g`：学段（可选）
- `t`：标签数组
- `a`：关联的锚点 ID 数组
- `m`：元数据（可选）

### 依赖边（Edge）

依赖边表示锚点之间的包含关系。

**字段说明**：
- `to`：目标锚点 ID
- `from`：源锚点 ID
- `strength`：强度（strong/weak）
- `reason`：原因
- `reviewStatus`：审核状态
- `containment`：包含关系数据

## 发布流程

### 版本管理

使用语义化版本（Semantic Versioning）：

- `major`：不兼容的 API 变更
- `minor`：向下兼容的功能性新增
- `patch`：向下兼容的问题修正

### 发布步骤

1. 更新 `CHANGELOG.md`
2. 更新 `package.json` 中的版本号
3. 运行 `pnpm verify`
4. 提交并推送
5. 创建 tag：`git tag v0.2.0`
6. 推送 tag：`git push --tags`
7. GitHub Actions 会自动发布到 npm

### 需要配置的 Secrets

在 GitHub 仓库的 Settings > Secrets and variables > Actions 中添加：

- `NPM_TOKEN`：npm 访问令牌（从 npmjs.com 获取）
- `GITHUB_TOKEN`：自动生成，无需配置

## 行为准则

- 尊重所有贡献者
- 专注于教育价值
- 保护学生隐私
- 确保数据准确性
- 遵守开源协议

## 联系方式

- GitHub Issues: https://github.com/qiuyiwu1989-star/dsh-k12-substrate/issues
- 邮箱: [待添加]

## 许可证

代码 MIT；随包数据 ODbL v1.0 + CC BY-SA 4.0。课标原文不随包分发，权利归中华人民共和国教育部。
