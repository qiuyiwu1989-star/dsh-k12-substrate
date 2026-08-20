# dsh-k12-substrate 使用教程

从安装到第一次完整辅导对话，5 分钟搞定。

## 前置条件

- Node.js 22.19.0 或更高版本
- pnpm（推荐）或 npm
- 已安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

## 第一步：安装插件

```bash
# 方式 1：直接安装到你的项目
pnpm add dsh-k12-substrate

# 方式 2：全局安装（推荐，这样所有项目都能用）
pnpm add -g dsh-k12-substrate
```

## 第二步：启动 DSH

```bash
# 方式 1：使用 patch 文件（推荐）
pnpm dsh web --patch ./node_modules/dsh-k12-substrate/cordis.patch.yml

# 方式 2：复制 preset 到 agent-presets 目录
cp -r node_modules/dsh-k12-substrate/examples/presets/k12-tutor ~/.dsh/.agent-presets/
pnpm dsh web --preset k12-tutor
```

## 第三步：开始对话

打开 DSH Web 界面，试试这些对话：

### 示例 1：查询字表位置

```
你：帮我看看「灞」这个字，小学要求会写吗？
```

AI 会自动调用 `k12_lookup_item` 工具查询，然后告诉你：

> 「灞」不在课标附录的任何清单里（已查 12 张表：常用字表 3500、基本字表 299、背诵篇目 135、英语二级/三级词汇等）。

### 示例 2：查询能力锚点

```
你：小学一年级语文有哪些识字要求？
```

AI 会调用 `k12_find_capability` 查询，返回可判定的能力锚点：

> - 能正确书写识字写字教学基本字表中的汉字（299 字）
> - 能认读常用字表一中的汉字（950 字）
> - 能背诵课标规定的古诗词篇目（135 首）

### 示例 3：记录掌握情况

```
你：孩子（代号 stu_0001）今天听写，基本字表里的「口、山、巾」都写对了，记一下。
```

AI 会调用 `k12_record_mastery` 记录：

> 已记录 3 条（proposed）：能正确书写识字写字教学基本字表中的汉字 3/299（1%）
>
> 注意：这是 AI 判定，建议老师或家长确认一下。

### 示例 4：查看学习进度

```
你：看看 stu_0001 现在学得怎么样了。
```

AI 会调用 `k12_learner_progress` 查看：

> - 基本字表：3/299（1%）
> - 常用字表一：0/950（0%）
> - 背诵篇目：0/135（0%）
> - 下一步可学：基本字表中的「一、二、三、上、下、大、小、天、地、人」

### 示例 5：了解覆盖范围

```
你：这个插件覆盖了哪些学科？
```

AI 会调用 `k12_substrate_info` 介绍：

> - 义务教育 14 科均已覆盖
> - 语文 186 条、科学 126 条、数学 73 条
> - 只有通过「判定客观、无需教师复核」门槛的锚点才随包分发
> - 大量「感受/体会/认同」类要求无法覆盖

## 两种模式

### 只读模式（readOnly: true）

适合只需要查询，不需要记录掌握情况的场景：

```yaml
- id: k12-substrate
  name: dsh-k12-substrate
  config:
    readOnly: true
```

只能用这 3 个工具：
- `k12_substrate_info`：了解覆盖范围
- `k12_find_capability`：查询能力锚点
- `k12_lookup_item`：查询字词篇目

### 读写模式（readOnly: false）

适合需要记录学习进度的场景（默认）：

```yaml
- id: k12-substrate
  name: dsh-k12-substrate
  config:
    readOnly: false
    profileDir: ''  # 留空则用 ~/.dsh-k12-substrate/profiles/
```

可以用全部 5 个工具：
- 上面 3 个查询工具
- `k12_record_mastery`：记录掌握情况
- `k12_learner_progress`：查看学习进度

## 档案存储

学生档案只存在本机，默认路径：`~/.dsh-k12-substrate/profiles/`

每个学生一个文件，文件名是学生代号（如 `stu_0001.profile.json`）。

**重要**：
- 档案只在本机，不上传任何服务器
- 建议用不含真实姓名的代号（如 `stu_0001`）
- 工具返回值只给计数，不逐条列出掌握明细（保护隐私）

## 常见问题

### Q: 为什么有些字查不到？

A: 只有在课标附录字表里的字才能查到。小学阶段要求的常用字约 3500 个，如果某个字不在这些字表里，说明小学阶段不要求掌握。

### Q: 为什么有些学科的能力锚点很少？

A: 只有"可判定"的能力锚点才会收录。比如"感受数学之美"这种要求无法二值判定，所以不会收录。当前覆盖：
- 语文 186 条
- 科学 126 条
- 数学 73 条
- 地理 18 条
- 劳动 14 条

### Q: AI 判定的掌握情况准确吗？

A: AI 判定一律标记为 `proposed`，需要教师或家长确认才算 `confirmed`。AI 说孩子会了不等于孩子会了，沉默更不算确认。

### Q: 这个插件能告诉我先学什么后学什么吗？

A: 不能。当前的依赖边是集合包含关系（如基本字表 ⊂ 常用字表一），不是学习路径。学习路径需要教育专家设计，这个插件只提供数据支持。

### Q: 档案数据安全吗？

A: 档案只存在本机，不上传任何服务器。工具返回值只给计数，不逐条列出掌握明细。建议用不含真实姓名的代号。

## 下一步

- 查看 [README.zh.md](../README.zh.md) 了解完整功能
- 查看 [ARCHITECTURE.md](../ARCHITECTURE.md) 了解插件架构
- 查看 [CONTRIBUTING.md](../CONTRIBUTING.md) 了解如何贡献
- 基于这个插件开发你自己的教育插件

## 获取帮助

- GitHub Issues: https://github.com/qiuyiwu1989-star/dsh-k12-substrate/issues
- DeepSeek Harness: https://github.com/deepseek-ai/deepseek-harness
