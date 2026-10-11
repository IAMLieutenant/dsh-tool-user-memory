# dsh-tool-user-memory

[![npm 版本][badge-npm]][npm-url] [![GitHub Release][badge-release]][release-url] [![MIT License][badge-license]](LICENSE)

**让 [DeepSeek Harness][harness] 记住你的偏好和项目背景，跨会话复用，换电脑也能迁移。**

记忆保存在本地 Markdown 文件中，可以直接查看、编辑和备份。本项目由社区独立开发和维护。

[English](README.en.md) · [npm][npm-url] · [更新日志](CHANGELOG.md) · [Release v0.4.0][release-url]

## 核心特点

| 能力 | 说明 |
|---|---|
| 跨会话记忆 | 保存语言、沟通方式和长期偏好，有效内容按预算注入系统提示词 |
| DSH 内管理 | 在当前窗口查看、搜索、新增、编辑和删除记忆 |
| 记忆置顶 | 重要偏好优先显示与注入，容量淘汰不会移出或截短置顶内容 |
| 项目隔离 | 分别保存项目约定；支持目录、Git 根目录或指定项目 |
| 跨电脑迁移 | JSON 导出与导入，目录映射、冲突预览、自动备份和撤销 |
| 修改保护 | 写入前保存历史；容量淘汰与截短前归档完整正文 |
| 生命周期管理 | 关键词检索、软失效、陈旧标注，以及默认关闭的自动整理 |
| 本地诊断 | 检查存储位置、项目身份和数量，排查配置与读取问题 |

### 配色跟随 DSH

弹窗只保留**概览、记忆、迁移**三个区域，直接读取 DSH 的配色和字体变量。

| 深色 | 浅色 |
|---|---|
| ![DSH 深色主题中的记忆概览][image-dark] | ![DSH 浅色主题中的记忆概览][image-light] |

截图来自本地 DSH 网页版，使用演示记忆。

## 快速开始

在已安装 DeepSeek Harness 的环境中运行：

```sh
dsh plugin --profile web add dsh-tool-user-memory@0.4.0
```

将 `web` 替换为实际 profile。安装或升级后重启 DSH；网页模式需重启 `dsh web`。已有记忆文件可继续读取，无需手动迁移。

1. 打开**插件 → dsh-tool-user-memory → 配置 → 管理记忆**。
2. 进入**记忆**，新增一条用户记忆，例如“默认用中文回答，先给结论”。
3. 开启新会话，调用 `memory_get` 核验已保存的偏好。

也可告诉 agent：**“使用 memory_update 保存我的回答偏好：默认用中文，先给结论，再解释细节。”**

插件默认启用工具和提示词注入；自动整理默认关闭。记忆保存成功不代表模型每次都会准确遵循，可以先通过工具验证存储和读取。

## 记忆管理与置顶

- **概览**：查看用户记忆、项目主题和画像容量。
- **记忆**：切换用户或项目范围，关键词筛选，查看全文、新增或编辑。
- **编辑框**：保存、取消；删除需再次确认。
- **迁移**：导出、选择导入文件、映射项目、预览和确认导入。

### 置顶重要偏好

打开一条**用户记忆**的编辑框，勾选**置顶记忆**并保存；取消勾选后保存即可取消置顶。项目记忆暂不提供置顶选项。

![用户记忆编辑框中的置顶设置][image-pin]

| 置顶后的行为 | 规则 |
|---|---|
| 优先显示 | 用户列表和 `memory_get` 优先返回置顶条目 |
| 优先注入 | 同组条目置顶优先，其次按更新时间从新到旧；仍受 `promptMaxBytes` 限制 |
| 容量保护 | 不自动淘汰或截短置顶内容；置顶集合本身超出 `maxBytes` 时拒绝保存，原内容不变 |
| 保留内容年龄 | 仅切换置顶不改变条目内容更新时间，也不恢复失效条目 |
| 随迁移保留 | 新版 JSON 保存 `pinned`；导入、备份和历史恢复保留状态 |

置顶保护针对容量淘汰。手动修改、删除和整理规则仍可改变条目；失效记忆即使置顶也不注入。置顶不保证全文总能进入上下文，超出提示词预算仍可能截短或省略。

0.3.0 等旧客户端可读取正文，但不执行置顶保护，重新保存或导出可能丢失置顶状态。回退前请保留新版导出及完整存储备份。

## 换电脑：导出与导入

### 在 DSH 弹窗中迁移

1. **旧电脑**：管理记忆 → 迁移，导出 JSON。
2. 通过 U 盘或你选择的方式，把文件传到新电脑。
3. **新电脑**：选择 JSON，将旧项目对应到本机已经存在的项目目录。
4. 查看新增、同名冲突和未映射项目的预览，再确认导入。
5. 检查结果；需要撤销时，使用界面保留的导入备份恢复。

![迁移完成后的结果与处理说明][image-migration]

界面默认**保留本机同名记忆**。相同内容不重复创建；未映射项目列出并跳过。预览后目标记忆或文件发生变化，需要重新预览。导入前备份待修改文件；导入后又被修改的文件会阻止撤销，避免覆盖新内容。

### 旧电脑不方便升级：使用独立命令

旧电脑无需升级 DSH 插件，也能使用新版导出工具。按终端类型选择：

**Windows 命令提示符（CMD，通常显示 `C:\...>`）：**

```cmd
npx --yes --package=dsh-tool-user-memory@0.4.0 dsh-memory export --file "%USERPROFILE%\dsh-memory.json"
```

**PowerShell（通常显示 `PS C:\...>`）：**

```powershell
npx --yes --package=dsh-tool-user-memory@0.4.0 dsh-memory export --file "$env:USERPROFILE\dsh-memory.json"
```

CMD 使用 `%USERPROFILE%`，PowerShell 使用 `$env:USERPROFILE`，不要混用。导出拒绝覆盖已有文件，再次导出请换文件名。DSH 可以保持打开；为取得更一致的快照，导出期间暂停修改记忆。

首次 `npx` 可能需要下载包及依赖；缓存完整后可加 `--offline`。导出最大 16 MiB，不读取账号配置或凭据文件，不会自行上传记忆。

### 命令行预览、执行与恢复

PowerShell 示例；项目 ID 来自导出结果或预览，目标目录必须存在：

```powershell
# 只预览，不写入
npx --yes --package=dsh-tool-user-memory@0.4.0 dsh-memory import --file "$env:USERPROFILE\dsh-memory.json" --map "项目ID=C:\projects\demo"
# 确认后使用相同选项，加入返回的 token
npx --yes --package=dsh-tool-user-memory@0.4.0 dsh-memory import --file "$env:USERPROFILE\dsh-memory.json" --map "项目ID=C:\projects\demo" --apply --token "返回的previewToken"
# 恢复此次导入前的文件
npx --yes --package=dsh-tool-user-memory@0.4.0 dsh-memory rollback --file "返回的backupPath"
```

| 选项 | 用途 |
|---|---|
| `--global-only` | 导出时只携带用户记忆 |
| `--skip-profile` | 导入时跳过用户记忆 |
| `--map "ID=目录"` | 项目映射，可重复指定 |
| `--policy keep-local` | 保留本机同名内容，默认策略 |
| `--policy use-imported` | 明确用导入内容替换同名记录 |
| `--profile <文件>` | 自定义画像文件 |
| `--workspace-base <目录>` | 自定义项目记忆根目录 |
| `--max-bytes <数字>` | 自定义画像容量 |
| `--workspace-mode git-root` | 按 Git 根目录定位项目，默认 `directory` |

CLI 默认读取 `$DSH_HOME/user-memory`；未设置时为 `~/.dsh/user-memory`。CLI **不会读取 DSH 插件配置**，自定义存储、容量或项目模式需要传入对应选项；DSH 工具和内置弹窗使用插件配置。

导入超出画像或主题容量时拒绝操作，不自动淘汰记忆。导出包和单次导入备份均限制 16 MiB。可处理的写入错误自动回滚；强制终止进程可能留下部分写入，可检查画像目录的 `migration-backups/*.json`。仍兼容 0.3.0 的版本 1 导出，缺省置顶状态为未置顶。

## 配置参考

默认配置即可使用。需要调整时，在 profile 的 `cordis.patch.yml` 中覆盖 id 为 `tool-user-memory` 的配置项。下表展示有效默认路径；配置中的空路径表示默认位置。

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `path` | `$DSH_HOME/user-memory/user.md` | 用户画像文件 |
| `maxBytes` | `8192` | 画像文件字节上限，整数，1–16 MiB；非置顶条目先失效、再从旧到新淘汰，原文先归档 |
| `promptMaxBytes` | `2048` | 画像正文注入预算，置顶优先；`0` 注入完整有效画像 |
| `includeInPrompt` | `true` | 启用画像和项目索引注入；关闭后工具仍可读取 |
| `staleAfterDays` | `0` | 超过指定天数未更新时添加陈旧标注，不删除；`0` 关闭 |
| `workspacePromptMaxBytes` | `512` | 项目索引正文预算；`0` 关闭项目索引注入 |
| `workspaceBase` | `$DSH_HOME/user-memory/workspace` | 项目记忆根目录 |
| `workspaceMode` | `directory` | 按会话目录；`git-root` 使用最近 Git 根目录，无仓库时用当前目录 |
| `projectPath` | `''` | 显式指定已存在的项目目录，优先于会话目录及项目模式 |
| `autoConsolidate` | `false` | 在回合边界异步触发自动整理 |
| `consolidateMinIntervalMs` | `600000` | 自动整理最小间隔，毫秒；`0` 不限制 |
| `autoInvalidateAfterDays` | `0` | 整理时软失效超过指定天数未更新的记录；`0` 关闭 |
| `consolidateProvider` | `''` | 可选模型辅助整理的 provider |
| `consolidateModel` | `''` | 模型辅助整理的 model id |
| `consolidateMaxTokens` | `1024` | 一次整理模型调用的输出 token 上限 |
| `consolidationLogPath` | `$DSH_HOME/user-memory/consolidation-log.md` | 整理审计日志 |

字节数不等于 token 数；提示词说明文字另计。项目主题正文最多 16 KiB，超限追加拒绝并保留原内容。`maxBytes` 不限制项目、历史、归档或日志总大小。超出注入预算的正文可通过 `memory_get` 或 `memory_topic` 按需读取。

默认目录模式下，子目录可能拥有独立记忆；Git 根目录模式让同仓库子目录共享记忆。切换模式或指定 `projectPath` 不自动合并旧记忆，可通过迁移完成目录对应。

## 记忆工具参考

插件向 agent 注册八个工具。项目工具使用会话目录或显式配置的项目路径。

| 工具 | 参数 | 能力 |
|---|---|---|
| `memory_get` | `query?`, `limit?`（默认 50，最多 100）, `includeStale?` | 读取画像，置顶优先；默认排除失效记录 |
| `memory_update` | `key`, `value`, `mode?`, `reason?`, `scope?` | 保存、追加、失效或删除；默认 `global`、`set` |
| `memory_search` | `query?`, `limit?`（默认 10，最多 20）, `includeStale?` | 检索画像与当前项目，支持中文子串，返回评分与摘要 |
| `memory_topic` | `topic` | 读取项目主题全文和失效信息 |
| `memory_consolidate` | `mode?`（默认 `plan`）, `useModel?` | 预览或执行整理，模型辅助需配置 provider 与 model |
| `memory_export` | `destination`, `scope?`（默认 `all`） | 导出本机 JSON；`global` 只导出画像 |
| `memory_import` | `source`, `includeProfile?`, `projectMap?`, `policy?`, `dryRun?`, `previewToken?` | 默认预览并保留本机内容，执行需有效预览 token |
| `memory_status` | 无 | 返回实际存储路径、项目身份和数量，不返回正文、不调用模型 |

`memory_update` 的 `mode`：`set` 覆盖、`append` 追加，均恢复有效；`invalidate` 保留原文与原因；`remove` 移除活动记录。后两者的 `value` 可为空。普通更新保留置顶状态，置顶开关由界面控制。写入结果返回容量淘汰、截短与归档信息。

`includeStale=true` 用于查看**软失效记录**；陈旧标注仍表示有效。项目正文按需读取，每轮只注入索引。主题名最多 64 字符，禁止路径分隔符、保留字符、`MEMORY` 和 Windows 保留设备名。

检索评分：主题名命中 3 分，正文每次 1 分、最多 5 分，全部关键词命中再加 4 分。尚未提供语义检索。

### 可选记忆整理

确定性规则合并重复记录（最新保留，其余失效），为相对时间补充绝对记录日期，按配置报告陈旧或失效旧内容。模型辅助校验 `add`、`merge`、`rewrite`、`invalidate`、`topic-add`、`topic-invalidate` 提案；模型不可用或响应非法时退回确定性规则。

`plan` 只返回方案；`apply` 执行并记审计日志。执行前核验内容和置顶状态，跳过已变化的条目，避免旧方案覆盖新修改。模型辅助把待整理记忆发送给配置的 provider，并产生模型调用费用。

## 数据存储、历史与备份

```text
$DSH_HOME/user-memory/
├── user.md                     # 用户画像
├── .history/<file-hash>/       # 每文件最近 20 份写入前快照
├── .archive/<file-hash>/       # 淘汰或截短前的完整条目
├── migration-backups/          # 导入备份与恢复记录
├── consolidation-log.md        # 整理审计日志
└── workspace/<project-hash>/
    ├── MEMORY.md               # 有效主题索引
    ├── <topic>.md              # 主题正文与元数据
    └── .history/<file-hash>/   # 主题写入前快照
```

Windows 默认画像为 `C:\Users\<用户名>\.dsh\user-memory\user.md`；自定义路径时以实际配置为准。默认不写入项目仓库。项目标识为有效目录 `realpath` 的 SHA-256 前 16 位；Windows 按小写处理，Linux 保留大小写。主题写入后重建索引。

| 状态或操作 | 行为 |
|---|---|
| 有效 | 参与注入和默认检索 |
| 陈旧 | 添加时间标注，仍有效 |
| 软失效 | 保留正文与原因，停止注入，默认检索隐藏 |
| 删除 | 移除活动记忆，停止后续注入；写入前历史仍保留 |
| 容量淘汰或截短 | 只处理非置顶条目，先归档完整原文 |

历史与归档在后台保存，精简界面暂不提供历史浏览或归档恢复入口；恢复能力由存储与管理后端提供。归档达到 1000 份或 64 MiB 后拒绝继续写入，不自动删除旧归档。手动编辑 Markdown 不生成快照，应保留标题、时间和置顶元数据；格式损坏可能拒绝读取。

**JSON 包含**画像、主题、更新时间、失效与置顶状态；**不包含**历史、归档、整理日志和账号配置。完整备份请另行复制实际存储目录。导出、历史和备份含记忆正文，请按个人资料保存。

删除不等于永久清除；彻底清除还需处理相关历史、归档、迁移备份、整理日志及另存导出文件。

## 诊断与故障排查

在 DSH 中用 `memory_status` 检查实际配置。独立命令：

```sh
npx --yes --package=dsh-tool-user-memory@0.4.0 dsh-memory doctor --cwd "项目目录"
npx --yes --package=dsh-tool-user-memory@0.4.0 dsh-memory manage
```

`doctor` 检查存储和项目身份；管理后端支持当前提示词预览。独立 `manage` 输出本机管理页地址，只监听本机，Ctrl+C 关闭。DSH 网页版使用内置弹窗。自定义配置仍需传入对应选项。

| 问题 | 检查方式 |
|---|---|
| 新会话没用记忆 | profile、路径、`includeInPrompt`、失效状态及预算；用 `memory_get` 核验 |
| 找不到项目记忆 | 会话目录、项目模式、`projectPath` 和迁移映射 |
| 没有管理入口 | 确认 0.4.0、重启 DSH 网页服务，并启用插件客户端 |
| 置顶容量不足 | 缩短内容、取消部分置顶或提高 `maxBytes`；失败时原画像不变 |
| 内容已发生变化 | 刷新，或重新预览后再确认 |
| 导出报 `ENOENT` | 检查路径、权限，勿混用 CMD 与 PowerShell 变量 |
| 首次 `npx` 较慢 | 检查 npm 网络；缓存完整后可用 `--offline` |

提示词把记忆标注为参考数据并要求模型不执行其中的指令，但不能保证所有模型遵守。插件没有覆盖所有敏感内容的自动过滤器，请勿保存密码、密钥或令牌。真实模型的记忆提取、使用及长期准确性仍需实际评估。

## 开发与验证

```sh
git clone https://github.com/IAMLieutenant/dsh-tool-user-memory.git
cd dsh-tool-user-memory
pnpm install --frozen-lockfile
pnpm test
pnpm run build
pnpm pack
dsh plugin --profile web add ./dsh-tool-user-memory-0.4.0.tgz
```

| DSH 依赖版本 | 测试 | 构建 |
|---|---|---|
| `0.1.7-alpha.1` | 127/127 通过 | 通过 |
| `0.2.0-rc.2` | 127/127 通过 | 通过 |

测试覆盖解析、置顶保护、预算、并发锁、存储、项目身份、整理、迁移恢复、管理后端、Harness 和 AgentLoop 集成；循环测试使用固定模型响应。在真实 DSH `0.1.7-alpha.1` 网页版验证了深浅主题、打开/关闭、取消、查看/保存、置顶/取消置顶和容量拒绝。依赖兼容测试不等于全部客户端实机验证。

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 配置、服务装配、工具注册和自动整理 |
| `src/profile.ts` / `src/store.ts` | 格式、置顶、容量、渲染和持久化 |
| `src/lock.ts` / `src/history.ts` | 并发、快照和归档 |
| `src/workspace.ts` / `src/prompt.ts` | 项目、索引、检索和注入 |
| `src/consolidate.ts` / `src/tools.ts` | 整理和记忆工具 |
| `src/migration.ts` / `src/migration-tools.ts` | 导出、预览、备份和回滚 |
| `src/manager.ts` / `src/manager-web.ts` | 管理操作和本机 HTTP 接口 |
| `src/manager-ui.ts` / `src/client.js` | 界面、DSH 入口和主题同步 |
| `src/migrate-cli.ts` / `scripts/build-assets.mjs` | 独立命令和客户端构建 |

## 版本演进

| 版本 | 主要变化 |
|---|---|
| `0.1.x` | 用户画像和跨会话注入 |
| `0.2.x` | 项目、检索、失效、时间标注、整理和并发修复 |
| `0.3.0` | JSON 迁移、目录映射、预览、冲突策略、备份和回滚 |
| `0.4.0` | DSH 内弹窗、置顶、主题同步、历史归档、迁移向导、项目身份和诊断 |

来源记录、用户确认的记忆候选、独立创建时间、项目优先级和可复现的效果评估是后续候选方向。语义检索和加密同步尚未实现，见 [ROADMAP](ROADMAP.md)。问题与建议欢迎提交 [Issues][issues-url]。

## 许可证

[MIT](LICENSE)

[badge-npm]: https://img.shields.io/npm/v/dsh-tool-user-memory
[badge-release]: https://img.shields.io/github/v/release/IAMLieutenant/dsh-tool-user-memory
[badge-license]: https://img.shields.io/badge/license-MIT-blue
[npm-url]: https://www.npmjs.com/package/dsh-tool-user-memory
[issues-url]: https://github.com/IAMLieutenant/dsh-tool-user-memory/issues
[release-url]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.4.0
[harness]: https://github.com/deepseek-ai/deepseek-harness
[image-dark]: https://raw.githubusercontent.com/IAMLieutenant/dsh-tool-user-memory/v0.4.0/docs/images/manager-dark.png
[image-light]: https://raw.githubusercontent.com/IAMLieutenant/dsh-tool-user-memory/v0.4.0/docs/images/manager-light.png
[image-pin]: https://raw.githubusercontent.com/IAMLieutenant/dsh-tool-user-memory/v0.4.0/docs/images/pin-setting.png
[image-migration]: https://raw.githubusercontent.com/IAMLieutenant/dsh-tool-user-memory/v0.4.0/docs/images/migration-result.png
