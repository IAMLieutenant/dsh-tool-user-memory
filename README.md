# dsh-tool-user-memory

[![npm 版本][badge-npm]][npm-url] [![GitHub Release][badge-release]][release-url] [![MIT License][badge-license]](LICENSE)

**让 [DeepSeek Harness][harness] 记住你的偏好和项目背景，跨会话复用，换电脑也能迁移。**

减少每次开新会话时重复说明语言偏好、沟通方式和项目约定。记忆保存在本地 Markdown 文件中，支持直接查看、编辑和备份。本项目由社区独立开发和维护。

[English][readme-en] · [npm][npm-url] · [更新日志][changelog] · [Release v0.3.0][release-url]

## 核心特点

| 你想解决的问题 | 插件提供的能力 |
|---|---|
| 新会话要重新交代偏好 | 全局用户画像持久保存，有效内容按预算注入系统提示词 |
| 多个项目的约定容易混淆 | 按会话工作目录分别保存项目记忆，读取当前目录对应的内容 |
| 换电脑后要重新积累记忆 | JSON 导出与导入，支持项目目录映射、冲突预览和导入备份 |
| 想知道究竟记住了什么 | 本地 Markdown 文件可查看、编辑和备份，无需额外部署记忆服务 |
| 旧信息过时后影响回答 | 软失效保留原文与原因，从提示词注入和默认检索中排除 |
| 记忆越来越多，查找费劲 | 关键词检索、按主题读取，以及可选的记忆整理 |

## 适合记住什么

- **个人偏好**：用中文回答、解释先给结论、采用你习惯的沟通方式。
- **项目背景**：测试命令、目录约定、重要决策，以及需要长期保留的操作说明。
- **需要搬走的上下文**：在旧电脑导出，再在新电脑按项目目录对应关系导入。

## 快速开始

在已安装 DeepSeek Harness 的环境中，运行：

```sh
dsh plugin --profile web add dsh-tool-user-memory@0.3.0
```

将 `web` 替换为实际使用的 profile。安装完成后重启 DSH 会话；web 模式需重启 `dsh web`。

默认启用记忆工具和提示词注入。自动整理默认关闭，模型辅助整理需要配置 provider 与 model。已有记忆文件升级到 0.3.0 时无需手动迁移。

### 安装后这样试一次

1. 在 DSH 中说：**“请使用 memory_update 将‘默认用中文回答，先给结论，再解释细节’保存到全局用户画像。”** 确认工具返回写入成功。
2. 使用同一存储配置开启新会话，说：**“请使用 memory_get 读取全局用户画像，告诉我已保存的回答偏好。”** 验证记忆能跨会话读取。
3. 想搬到另一台电脑时，按[导出与导入指南](#换电脑导出与导入记忆)操作；旧电脑无需升级插件即可导出。

模型是否准确采用偏好仍取决于其行为。上述步骤可以先验证记忆已经保存，并能在新会话中读取。

使用反馈、问题和功能建议欢迎提交到 [Issues][issues-url]。

## 目录

- [1. 功能与工作原理](#1-功能与工作原理)
- [2. 安装与验证](#2-安装与验证)
- [3. 配置](#3-配置)
- [4. 使用示例](#4-使用示例)
- [5. 数据存储与生命周期](#5-数据存储与生命周期)
- [6. 工具参考](#6-工具参考)
- [7. 限制与故障排查](#7-限制与故障排查)
- [8. 开发与验证](#8-开发与验证)
- [9. 版本演进与规划](#9-版本演进与规划)

## 1. 功能与工作原理

### 记忆范围

| 范围 | 适用内容 | 读取方式 |
|---|---|---|
| 全局用户画像 | 语言偏好、沟通风格、个人背景、长期目标 | 在预算范围内注入系统提示词；可通过 `memory_get` 读取 |
| 项目记忆 | 当前项目的背景、约定和操作说明 | 按会话工作目录选择索引；通过 `memory_search` 检索、`memory_topic` 读取正文 |

全局用户画像在使用同一存储路径的 profile 和工作区之间共享。项目记忆按会话工作目录定位，目录内的子目录可能对应不同的记忆位置。

### 主要功能

| 功能 | 说明 |
|---|---|
| 持久化存储 | 以 Markdown 保存条目，支持直接查看和编辑 |
| 提示词注入 | 在提示词组装时读取有效画像与当前项目索引，按字节预算裁剪 |
| 关键词检索 | 对用户画像和当前项目记忆进行关键词匹配，返回评分与摘要 |
| 时间管理 | 记录更新时间，支持陈旧标注和软失效 |
| 记忆整理 | 合并重复条目、补充相对时间的记录日期，并按配置处理过时内容 |
| 审计记录 | 记录整理操作的执行结果、跳过原因及触发来源 |

### 处理流程

```text
用户提出记忆请求
  → agent 调用 memory_update
  → 插件写入全局画像或当前项目的主题文件
  → 后续提示词组装时读取有效画像与项目索引
  → agent 按需调用记忆工具读取其余内容
```

写入采用原子替换，并通过进程内串行化与跨进程锁保护读改写操作。整理执行前会校验条目是否与生成方案时一致；已经变更的条目会跳过，避免旧方案覆盖新内容。

## 2. 安装与验证

### 环境要求

- 已安装并可运行 [DeepSeek Harness][harness] 的 `dsh` CLI。
- 0.3.0 已在 DSH 依赖版本 `0.1.7-alpha.1` 和 `0.2.0-rc.2` 上分别完成构建与 108 项测试。
- `dsh plugin` 负责安装 npm 包，并根据包中的 `dsh.bundle.patch` 声明将插件加入 profile 的 bundle 配置。

### 安装与升级

快速开始中的命令同时适用于安装和升级。其他 profile 使用相同语法，例如：

```sh
dsh plugin --profile headless add dsh-tool-user-memory@0.3.0
```

### 从源码安装

```sh
git clone https://github.com/IAMLieutenant/dsh-tool-user-memory.git
cd dsh-tool-user-memory
pnpm install --frozen-lockfile
pnpm run build
pnpm pack
dsh plugin --profile web add ./dsh-tool-user-memory-0.3.0.tgz
```

### 验证安装

1. 检查 profile 的 `package.json`，确认 `dsh.profile.bundles` 包含 `dsh-tool-user-memory`。
2. 重启会话后，询问 agent 可用的记忆工具。0.3.0 提供下文列出的七个工具。
3. 请求保存一条偏好，确认工具返回成功，再检查画像文件是否包含对应条目。

profile 配置示例：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-tool-user-memory"
      ]
    }
  }
}
```

默认画像路径为 `$DSH_HOME/user-memory/user.md`。Windows 默认位置为 `C:\Users\<用户名>\.dsh\user-memory\user.md`；自定义 `DSH_HOME` 或 `path` 时以实际配置为准。

## 3. 配置

插件可使用默认配置运行。如需调整，在 profile 的 `cordis.patch.yml` 中覆盖 id 为 `tool-user-memory` 的配置项。

下表中的存储路径为未设置自定义路径时的有效默认值。

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `path` | `$DSH_HOME/user-memory/user.md` | 全局用户画像路径 |
| `maxBytes` | `8192` | 画像文件的字节上限；超限时优先淘汰失效条目，再按更新时间从旧到新淘汰 |
| `promptMaxBytes` | `2048` | 注入的画像正文预算；优先保留较新的条目，过长条目会标注截断；`0` 表示注入完整有效画像 |
| `includeInPrompt` | `true` | 是否启用记忆提示词注入；关闭时同时停止画像与项目索引注入 |
| `staleAfterDays` | `0` | 超过指定天数未更新的条目显示 `[stale: last updated Nd ago]`；仅作标注，`0` 表示关闭 |
| `workspacePromptMaxBytes` | `512` | 注入的项目索引正文预算；`0` 表示关闭项目索引注入 |
| `workspaceBase` | `$DSH_HOME/user-memory/workspace` | 项目记忆根目录 |
| `autoConsolidate` | `false` | 是否在回合边界异步触发自动整理 |
| `consolidateMinIntervalMs` | `600000` | 自动整理的最小间隔，单位为毫秒；`0` 表示不设置间隔限制 |
| `autoInvalidateAfterDays` | `0` | 整理时软失效超过指定天数未更新的条目；`0` 表示关闭 |
| `consolidateProvider` | `''` | 模型辅助整理使用的 provider；留空时使用确定性规则 |
| `consolidateModel` | `''` | 模型辅助整理使用的 model id |
| `consolidateMaxTokens` | `1024` | 单次整理模型调用的输出 token 上限 |
| `consolidationLogPath` | `$DSH_HOME/user-memory/consolidation-log.md` | 整理审计日志路径 |

### 容量与预算

- `promptMaxBytes` 与 `workspacePromptMaxBytes` 限制注入的记忆正文，提示词说明文字另计；字节数与 token 数不等价。
- 超出注入预算的画像内容可通过 `memory_get` 读取，项目正文通过 `memory_topic` 按需读取。
- 单个项目主题的正文上限为 16 KiB，包括追加后的总内容。超限追加会被拒绝并保留原内容。
- `maxBytes` 限制全局画像文件，不是全部项目记忆与日志的总容量限制。
- 主题名不能使用 `MEMORY`、Windows 保留设备名或包含文件名保留字符；名称长度最多 64 个字符。

## 4. 使用示例

以下示例说明如何向 agent 表达操作意图。实际工具调用取决于模型；保存或修改后，可检查工具结果及本地文件。

### 保存与查询偏好

> 记住：我偏好简洁的中文回答。

预期调用为 `memory_update`，默认写入全局画像。适合保存长期偏好、个人背景和长期目标。一次性任务以及密钥、密码、令牌不应作为记忆内容。

> 查看已保存的语言和沟通风格偏好。

可通过 `memory_get` 查询用户画像，或通过 `memory_search` 检索画像与当前项目记忆。

### 更新、失效与删除

| 意图 | 示例 | 对应操作 |
|---|---|---|
| 更新内容 | 将语言偏好改为英文 | `memory_update`，`mode=set` |
| 保留历史并停止使用 | 将旧项目背景标记为已失效，原因是项目迁移 | `memory_update`，`mode=invalidate`，填写 `reason` |
| 移除记录 | 删除已保存的语言偏好 | `memory_update`，`mode=remove` |

软失效保留历史记录，并将条目排除在提示词和默认检索结果之外。删除会移除记录。

### 保存项目约定

在目标项目目录打开会话后，提出：

> 将以下约定保存到当前项目记忆：使用 pnpm 管理依赖，提交前运行 pnpm test。

对应调用为 `memory_update`，`scope=workspace`。在其他工作目录打开的会话会读取该目录对应的项目记忆。

### 整理记忆

> 先生成记忆整理方案，列出计划执行的操作。

使用 `memory_consolidate` 的 `mode=plan` 查看方案。需要执行时，使用 `mode=apply`；执行结果写入审计日志。模型辅助整理需配置 provider 与 model，并使用 `useModel=true`。

### 验证跨会话读取

1. 保存一条语言偏好，并确认写入成功。
2. 在启用同一插件配置的新会话中询问已记录的语言偏好。
3. 检查回答是否与记录一致；必要时调用 `memory_get` 核验。

在默认配置下，有效画像会在预算范围内注入系统提示词，因此模型无需先调用工具即可读取这部分内容。实际回答是否正确仍取决于模型行为。

### 换电脑：导出与导入记忆

0.3.0 提供 `memory_export` / `memory_import` 和独立命令 `dsh-memory`。导出包含全局画像、全部已存储项目、更新时间及失效状态；仅读取记忆文件，不读取整理日志、插件配置、缓存或账号凭证文件。导入根据新项目目录重新生成索引，默认保留本机同名内容。未映射的项目会明确列出并跳过。

**旧电脑无需升级插件。** 按终端类型选择下面的一条命令，将导出文件保存到用户目录，再通过 U 盘或你选择的方式传到新电脑。

**Windows 命令提示符（CMD，通常显示 `C:\...>`）：**

```cmd
npx --yes --package=dsh-tool-user-memory@0.3.0 dsh-memory export --file "%USERPROFILE%\dsh-memory.json"
```

**PowerShell（通常显示 `PS C:\...>`）：**

```powershell
npx --yes --package=dsh-tool-user-memory@0.3.0 dsh-memory export --file "$env:USERPROFILE\dsh-memory.json"
```

CMD 使用 `%USERPROFILE%`，PowerShell 使用 `$env:USERPROFILE`，请不要混用。混用可能把变量名当成目录名，导致 `ENOENT`。

已有文件不会被覆盖；再次导出时请换一个文件名。DSH 可以保持打开，导出对每份记忆加锁读取；各项目快照可能来自不同时间，导出期间暂停修改记忆可取得更一致的快照。原项目目录已经删除也能导出其已存储记忆。

首次执行 `npx` 可能需要下载包及依赖；等待时间可能来自网络请求。若这条命令以前已成功运行、包及依赖已缓存，可在 `npx` 后加入 `--offline` 使用缓存。CMD 示例：

```cmd
npx --offline --yes --package=dsh-tool-user-memory@0.3.0 dsh-memory export --file "%USERPROFILE%\dsh-memory-offline.json"
```

缓存不完整时，离线命令会报错，需要使用联网命令完成下载。导出包最大为 16 MiB，实际大小取决于已保存的记忆。

在**新电脑**升级插件并重启会话后，对 agent 说：

> 使用 memory_import 预览导入 `C:\Users\你的用户名\dsh-memory.json`，默认保留本机内容。列出未匹配的项目，先不要执行导入。

如需项目记忆，告诉 agent 哪个旧项目对应哪个本机目录。确认新增、冲突和未匹配数量后，再让 agent 执行该预览。导入必须携带 `previewToken`；文件、配置或目标记忆已变化时，需要重新预览。

也可完全使用命令行。以下示例里的项目 ID 来自导出结果或导入预览；新项目目录必须存在。

**PowerShell：**

```powershell
npx --yes --package=dsh-tool-user-memory@0.3.0 dsh-memory import --file "$env:USERPROFILE\dsh-memory.json" --map "项目ID=C:\projects\demo"
# 确认预览后，保留相同选项并加入执行标志与返回的 token：
npx --yes --package=dsh-tool-user-memory@0.3.0 dsh-memory import --file "$env:USERPROFILE\dsh-memory.json" --map "项目ID=C:\projects\demo" --apply --token "返回的previewToken"
```

**CMD：** 先运行第一行检查预览，再替换第二行的 token 并执行。

```cmd
npx --yes --package=dsh-tool-user-memory@0.3.0 dsh-memory import --file "%USERPROFILE%\dsh-memory.json" --map "项目ID=C:\projects\demo"
npx --yes --package=dsh-tool-user-memory@0.3.0 dsh-memory import --file "%USERPROFILE%\dsh-memory.json" --map "项目ID=C:\projects\demo" --apply --token "返回的previewToken"
```

`--policy use-imported` 明确替换同名内容；`--skip-profile` 只导入映射的项目；多个项目使用多个 `--map`。导入超出全局容量或单主题容量时会拒绝操作，不自动淘汰记忆。导出包和单次导入备份均限制为 16 MiB。

CLI 默认读取 `$DSH_HOME/user-memory`（未设置 `DSH_HOME` 时为 `~/.dsh/user-memory`），不会读取 DSH 插件配置。自定义存储或容量时，传入 `--profile <user.md路径>`、`--workspace-base <目录>`、`--max-bytes <字节数>`；DSH 工具直接使用插件配置。

导入先备份所有待修改文件，再写入记忆；发生可处理的写入错误时自动回滚。进程被强制终止时可能只写入一部分，恢复记录保存在画像目录的 `migration-backups/*.json`。工具返回 `backupPath` 后，可使用相同存储选项恢复：

```powershell
npx --yes --package=dsh-tool-user-memory@0.3.0 dsh-memory rollback --file "backupPath对应的文件"
```

导入后又被修改的文件会阻止回滚，以免覆盖新内容。导出 JSON 和备份包含完整记忆正文，请按个人资料保存；导出过程不会上传文件。

## 5. 数据存储与生命周期

### 默认文件布局

```text
$DSH_HOME/user-memory/
├── user.md                     # 全局用户画像
├── consolidation-log.md        # 整理审计日志
└── workspace/
    └── <hash16>/               # 会话工作目录对应的存储目录
        ├── MEMORY.md           # 有效主题的索引
        └── <topic>.md          # 主题正文与元数据
```

项目目录标识取会话工作目录 `realpath` 转为小写后的 SHA-256 前 16 位。索引包含主题名与一行摘要，在主题写入后重建。

默认存储位置在 `$DSH_HOME` 下，不写入项目仓库。自定义 `path` 或 `workspaceBase` 后，存储位置由配置决定。

### 条目状态

| 状态或操作 | 行为 |
|---|---|
| 有效 | 可参与提示词注入和默认检索 |
| 陈旧标注 | 达到 `staleAfterDays` 阈值时添加提示；条目仍有效 |
| 软失效 | 保留正文、失效时间与原因；停止注入，默认检索隐藏 |
| 恢复有效 | 对同一个键执行 `set` 或 `append` |
| 淘汰 | 全局画像超出容量上限时移除条目，优先处理失效及较旧的条目 |
| 删除 | 执行 `remove` 后移除对应记录 |

### 手动编辑

画像是普通 Markdown 文件，可保留其标题和元数据格式直接编辑。插件在后续读取与提示词组装时使用文件内容。

```markdown
# User Memory

## language
<!-- ts: 2026-10-10T01:15:38.092Z -->
简洁的中文回答

## old-project
<!-- ts: 2026-08-14T00:00:00.000Z -->
<!-- invalid: 2026-10-10T02:00:00.000Z | 项目已迁移 -->
旧项目说明
```

## 6. 工具参考

### `memory_get`

读取全局用户画像。

| 参数 | 必填 | 说明 |
|---|---|---|
| `query` | 否 | 按键或内容进行关键词过滤 |
| `limit` | 否 | 最大返回条数，默认 50，上限 100 |
| `includeStale` | 否 | `true` 时包含软失效条目及其失效时间与原因，默认 `false` |

返回 `{ ok, total, invalidated, rendered }`。`rendered` 为供模型读取的文本；启用 `staleAfterDays` 后可包含陈旧标注。

### `memory_update`

写入、追加、软失效或删除记忆。

| 参数 | 必填 | 说明 |
|---|---|---|
| `key` | 是 | 记忆键，例如 `language` 或 `communication-style` |
| `value` | 是 | 正文；`invalidate` 和 `remove` 时可传空字符串 |
| `mode` | 否 | `set` 覆盖并恢复有效；`append` 追加并恢复有效；`remove` 删除；`invalidate` 软失效 |
| `reason` | 否 | 软失效原因，与条目一起保存 |
| `scope` | 否 | `global` 写入用户画像；`workspace` 写入当前项目记忆，默认 `global` |

返回 `{ ok, scope, key, mode, bytes, error? }`。读取失效记录时，在 `memory_get` 或 `memory_search` 中设置 `includeStale=true`。

### `memory_search`

对全局画像和当前项目记忆执行关键词检索。

| 参数 | 必填 | 说明 |
|---|---|---|
| `query` | 否 | 空格分隔的关键词，支持中文子串；留空按更新时间返回记录 |
| `limit` | 否 | 最大返回条数，默认 10，上限 20 |
| `includeStale` | 否 | 是否包含软失效条目，默认 `false` |

返回 `{ ok, total, results }`。结果包含 `scope`、`topic`、`score`、`updatedAt`、`snippet`。

评分规则：主题名匹配记 3 分，正文每次匹配记 1 分且上限 5 分，全部关键词匹配额外加 4 分。画像与项目结果统一排序。

### `memory_topic`

读取一个项目记忆主题的完整正文。

| 参数 | 必填 | 说明 |
|---|---|---|
| `topic` | 是 | 主题名，可从项目索引或检索结果获取 |

返回 `{ ok, topic, updatedAt, invalidated, invalidReason, body }`。主题正文通过工具按需读取，不直接注入每轮提示词。

### `memory_consolidate`

生成或执行整理方案。

| 参数 | 必填 | 说明 |
|---|---|---|
| `mode` | 否 | `plan` 返回方案；`apply` 执行操作并记录结果 |
| `useModel` | 否 | 是否请求模型辅助整理；需要配置 provider 与 model |

整理包括以下处理：

1. **重复合并**：保留归一化内容相同的最新记录，其余记录软失效。
2. **时间标注**：为包含相对时间的记录补充绝对记录日期，不改写原文中的日期含义。
3. **过时处理**：报告达到陈旧阈值的记录，并按 `autoInvalidateAfterDays` 执行软失效。
4. **模型提案**：校验并处理 `add`、`merge`、`rewrite`、`invalidate`、`topic-add` 和 `topic-invalidate`；模型不可用或响应不合法时使用确定性规则结果。

审计日志记录触发来源、时间、已执行和已跳过的操作及原因。执行时发现条目已变更或合并目标不再有效，会跳过相关操作。

### `memory_export`

参数：`destination`（必填，本机 JSON 路径）、`scope`（`all` 或 `global`，默认 `all`）。返回文件路径、全局条目数及项目 ID、原目录和主题数。拒绝覆盖已有文件或写入活动记忆文件。

### `memory_import`

参数：`source`（必填）、`includeProfile`（默认 `true`）、`projectMap`（`[{id, path}]`）、`policy`（默认 `keep-local`）、`dryRun`（默认 `true`）、`previewToken`。预览不写入记忆；`dryRun=false` 必须传入已确认的预览 token。执行返回实际数量及 `backupPath`，重复导入相同内容不会重复创建条目。

## 7. 限制与故障排查

### 行为与安全边界

- 提示词将记忆标注为参考数据，并要求模型避免执行其中的指令。这是提示词约束，不能保证所有模型都遵守。
- 工具说明要求模型不保存凭据，但插件没有覆盖所有敏感内容的自动过滤器。记忆文件不应包含密钥、密码或令牌。
- 默认记忆存储、检索和规则整理在本地执行。模型辅助整理会将待整理的记忆提交给配置的 provider，并产生相应模型调用费用。
- 测试验证存储行为和工具集成；尚未评估真实模型的记忆提取、使用及长期准确性。

### 新会话未使用已保存的记忆

检查以下项目：

1. profile 的 `dsh.profile.bundles` 是否包含插件，安装后是否已重启会话。
2. 画像是否已写入，条目是否有效，`includeInPrompt` 是否开启。
3. 内容是否因注入预算被省略或截断；可使用 `memory_get` 读取完整画像。
4. 项目记忆对应的会话工作目录是否一致且可访问。

### 工作目录不可用

项目记忆依赖会话的工作目录。目录缺失或不可访问时，项目写入和主题读取会返回错误；仍可使用 `scope=global` 保存个人偏好。

### 清除数据

全局画像、项目记忆和审计日志分别保存。清除画像需删除实际配置的 `user.md`；清除项目记忆需删除对应的项目存储目录；清除整理历史需删除审计日志。仅删除画像文件不会移除项目记忆或日志。

## 8. 开发与验证

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm run build
```

0.3.0 的验证结果：

| DSH 依赖版本 | 测试 | TypeScript 构建 |
|---|---|---|
| `0.1.7-alpha.1` | 108/108 通过 | 通过 |
| `0.2.0-rc.2` | 108/108 通过 | 通过 |

测试覆盖文档解析、并发锁、存储、项目记忆、整理、Harness 集成和 AgentLoop 工具调用。循环测试使用固定模型响应。

### 代码结构

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 插件配置、服务装配与回合边界触发 |
| `src/profile.ts` | 画像解析、序列化、合并、淘汰与渲染 |
| `src/store.ts` | 全局画像的原子写入与并发保护 |
| `src/lock.ts` | 进程内串行化与跨进程锁 |
| `src/workspace.ts` | 项目主题存储、索引重建与检索 |
| `src/consolidate.ts` | 整理方案、模型提案校验、执行与审计 |
| `src/tools.ts` | 核心记忆工具与迁移工具注册 |
| `src/migration.ts` | 导出格式校验、导入预览、备份与恢复 |
| `src/migrate-cli.ts` | 独立记忆迁移命令 |
| `src/prompt.ts` | 用户画像与项目索引的提示词注入 |

存储层使用 `node:fs` 管理插件自身的持久化状态。

## 9. 版本演进与规划

### 已发布版本

| 版本 | 主要变化 |
|---|---|
| `0.1.x` | 提供全局用户画像与跨会话提示词注入 |
| `0.2.0` | 增加项目记忆、关键词检索、软失效、时间标注与整理 |
| `0.2.1` | 修复并发写入丢失及日期改写重置记忆年龄的问题 |
| `0.2.2` | 修复旧整理方案覆盖新内容、失效记录意外恢复、保留主题名冲突及字节限制问题 |
| `0.2.3` | 将插件列表描述改为简洁中文，并更新中英文 README 的结构与表述 |
| `0.3.0` | 增加跨电脑记忆导出、导入预览、项目目录映射、冲突策略、自动备份和回滚命令 |

完整变更记录见 [CHANGELOG][changelog]。

### 后续规划

- 基于会话摘要的语义整理，并设置运行频率和预算限制。
- 增加会话空闲、上下文压缩和定时整理触发方式。
- 为条目单独记录首次创建时间。
- 按会话身份区分多用户画像。

以上功能尚未实现，进度与验收条件见 [issue #1][issue1]。

## 许可证

[MIT](LICENSE)

[badge-npm]: https://img.shields.io/npm/v/dsh-tool-user-memory
[badge-release]: https://img.shields.io/github/v/release/IAMLieutenant/dsh-tool-user-memory
[badge-license]: https://img.shields.io/badge/license-MIT-blue
[npm-url]: https://www.npmjs.com/package/dsh-tool-user-memory
[issues-url]: https://github.com/IAMLieutenant/dsh-tool-user-memory/issues
[release-url]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.3.0
[changelog]: CHANGELOG.md
[readme-en]: README.en.md
[harness]: https://github.com/deepseek-ai/deepseek-harness
[issue1]: https://github.com/IAMLieutenant/dsh-tool-user-memory/issues/1
