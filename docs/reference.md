# 使用与配置参考

返回 [首页](../README.md)。本页对应 `0.4.1`，候选流程见 [候选确认说明](candidate-review.md)。

下列独立命令使用本仓库构建后的 `node lib/migrate-cli.js`，请先在仓库根目录执行 `pnpm install --frozen-lockfile` 和 `pnpm run build`。旧版 `0.4.0` 的 CLI 不理解新增来源元数据，处理 `0.4.1` 数据时请使用对应版本的命令。

## 记忆管理与置顶

- **待确认**：核对候选、选择范围、预览替代内容后保存；忽略不会写入记忆。
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
node lib/migrate-cli.js export --file "%USERPROFILE%\dsh-memory.json"
```

**PowerShell（通常显示 `PS C:\...>`）：**

```powershell
node lib/migrate-cli.js export --file "$env:USERPROFILE\dsh-memory.json"
```

CMD 使用 `%USERPROFILE%`，PowerShell 使用 `$env:USERPROFILE`，不要混用。导出拒绝覆盖已有文件，再次导出请换文件名。DSH 可以保持打开；为取得更一致的快照，导出期间暂停修改记忆。

首次构建需要安装依赖；构建完成后，上面的独立命令直接使用本机文件。导出最大 16 MiB，不读取账号配置或凭据文件，不会自行上传记忆。

### 命令行预览、执行与恢复

PowerShell 示例；项目 ID 来自导出结果或预览，目标目录必须存在：

```powershell
# 只预览，不写入
node lib/migrate-cli.js import --file "$env:USERPROFILE\dsh-memory.json" --map "项目ID=C:\projects\demo"
# 确认后使用相同选项，加入返回的 token
node lib/migrate-cli.js import --file "$env:USERPROFILE\dsh-memory.json" --map "项目ID=C:\projects\demo" --apply --token "返回的previewToken"
# 恢复此次导入前的文件
node lib/migrate-cli.js rollback --file "返回的backupPath"
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

`0.4.1` 向 agent 注册九个工具。项目工具使用会话目录或显式配置的项目路径。

| 工具 | 参数 | 能力 |
|---|---|---|
| `memory_propose` | `key`, `value`, `scope`, `excerpt?`, `reason?` | 提交待确认候选；确认前不参与检索或注入 |
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
├── user.md.candidates.json     # 候选与审阅状态
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

历史与归档在后台保存，精简界面暂不提供历史浏览或归档恢复入口；恢复能力由存储与管理后端提供。归档达到 1000 份或 64 MiB 后拒绝继续写入，不自动删除旧归档。手动编辑 Markdown 不生成快照，应保留标题、时间、置顶和来源元数据；格式损坏可能拒绝读取。

**JSON 包含**画像、主题、更新时间、失效与置顶状态，以及新版来源元数据；**不包含**待确认候选、历史、归档、整理日志和账号配置。完整备份请另行复制实际存储目录。导出、历史和备份含记忆正文，请按个人资料保存。

删除不等于永久清除；彻底清除还需处理相关历史、归档、迁移备份、整理日志及另存导出文件。

## 诊断与故障排查

在 DSH 中用 `memory_status` 检查实际配置。独立命令：

```sh
node lib/migrate-cli.js doctor --cwd "项目目录"
node lib/migrate-cli.js manage
```

`doctor` 检查存储和项目身份；管理后端支持当前提示词预览。独立 `manage` 输出本机管理页地址，只监听本机，Ctrl+C 关闭。DSH 网页版使用内置弹窗。自定义配置仍需传入对应选项。

| 问题 | 检查方式 |
|---|---|
| 新会话没用记忆 | profile、路径、`includeInPrompt`、失效状态及预算；用 `memory_get` 核验 |
| 找不到项目记忆 | 会话目录、项目模式、`projectPath` 和迁移映射 |
| 没有管理入口 | 确认所用版本、重启 DSH 网页服务，并启用插件客户端 |
| 置顶容量不足 | 缩短内容、取消部分置顶或提高 `maxBytes`；失败时原画像不变 |
| 内容已发生变化 | 刷新，或重新预览后再确认 |
| 导出报 `ENOENT` | 检查路径、权限，勿混用 CMD 与 PowerShell 变量 |
| 首次安装依赖较慢 | 检查 npm 网络；完成安装和构建后再运行独立命令 |

提示词把记忆标注为参考数据并要求模型不执行其中的指令，但不能保证所有模型遵守。插件没有覆盖所有敏感内容的自动过滤器，请勿保存密码、密钥或令牌。真实模型的记忆提取、使用及长期准确性仍需实际评估。

[image-pin]: images/pin-setting.png
[image-migration]: images/migration-result.png
