# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.3] — 2026-10-10

### Changed

- 将 DSH 插件列表使用的包描述改为简洁中文：为 DSH 提供跨会话用户偏好与项目记忆。
- 中英文 README 采用客观、专业的文档表述，重新组织安装、配置、使用示例与工具参考，并明确默认行为、存储范围、容量限制和验证范围。

## [0.2.2] — 2026-10-10

这次主要让记忆保存和整理更可靠；已有记忆文件不用手动迁移，工具和默认开关不变。

### Fixed

- **旧整理方案覆盖新内容**：整理记住规划时的原始内容，写入时在锁内核对；用户或另一会话已更新的条目会跳过，并在结果与日志中说明原因。全局画像和项目主题都受保护；合并还会核对保留的目标，避免目标消失后把剩下的记录也失效。
- **旧记录被整理意外复活**：重复合并或失效优先于内容改写，同一轮不重复修改同一目标；日期改写保留原时间戳和失效状态。模型提议的 add/topic-add 也不能覆盖已有内容。
- **项目主题写入成功却读不到**：禁止用内部索引名称 MEMORY（不区分大小写）作为主题名，补齐 Windows 设备名称校验；主题大小写变化时复用原文件。
- **追加绕过 16 KiB 上限**：校验追加后的总正文，超限返回错误并保留原内容。
- **提示词超过配置预算**：过大的最新条目按 UTF-8 字节安全截短并带标记；记忆正文遵守配置上限，完整内容仍可通过 memory_get 读取。说明文字不计入正文预算。文件侧也计算 Markdown 转义增加的字节，预算小到无法容纳元数据时拒绝写入。
- **并发整理日志丢记录**：日志在同一把文件锁下追加，避免整份读写互相覆盖。执行时全被跳过的方案会显示实际的 applied/skipped 数量。

### Changed

- 中英文 README 更新到 0.2.2，增加直白的版本差异、升级方法与容量说明；明确敏感内容与提示词约束的实际边界。
- 添加 pnpm-workspace.yaml 的 autoInstallPeers: false 项目配置，与现有锁文件一致。

### Verified

- 两条依赖线 0.1.7-alpha.1 与 0.2.0-rc.2 各 92/92 测试通过，TypeScript 构建通过。
- 新增 13 项回归测试，覆盖旧方案冲突、合并目标变化、失效记录保持、主题名、追加容量、UTF-8 预算、转义开销与并发日志。
- 循环测试使用固定模型响应，验证集成行为；未把它当作真实模型的记忆质量评估。

## [0.2.1] — 2026-10-10

修掉两个 0.2.0 引入的真实缺陷，都与并发写入和时间语义有关。

### Fixed

- **并发写入会静默丢数据**：`memory_update` 与工作区主题写入都是「读、改、写」三步，没有互斥。两个会话同时写入时，双方都收到成功，但后写的整份文档覆盖先写的，先写的那条消失。现在两道锁：进程内按锁路径串行，跨进程用 `wx` 独占创建的锁文件，释放时删除；锁文件超过 30 秒视为持有进程已死，自动回收。
- **整理的时间锚定会把条目年龄归零**：给「明天 / 下周」这类相对时间补绝对日期时走的是 `set` 语义，会刷新 `updatedAt`。后果是这条记忆不再被判为陈旧，`autoInvalidateAfterDays` 也永远追不上它，一次纯内容编辑反而废掉了老化机制。现在新增 `store.rewrite()`：只改内容，保留原时间戳。整理里的 `rewrite` 走这条路径，`add` 仍然打当前时间。
- 写入失败不再只是抛异常，改为返回结构化错误，方便工具把原因回给模型。

### Changed

- 包描述更新到现状：五个工具、分层记忆、时间语义、后台整理。

### Verified

- 79/79 测试通过，两条依赖线各跑一遍：`0.1.7-alpha.1` 与 `0.2.0-rc.2`。
- 新增 11 个测试：6 个锁原语测试、3 个存储测试、1 个工作区并发测试、1 个整理测试。
- 两条缺陷在修复前都在本机复现过：20 路并发从「丢 1 条」变为「全存活」，时间锚定从「时间戳归零」变为「时间戳保留且锚注写入」。

## [0.2.0] — 2026-10-09

适配 DSH 0.1.7 / 0.2.0-rc 版本线（2026-08-17 之后的全部运行时演进）。

### Changed

- **peer 依赖升级到新版本线**：`@deepseek-ai/cordis >=4.0.3 <5.0.0`、`@deepseek-ai/dsh-tools` 与 `@deepseek-ai/dsh-home-paths` `>=0.1.7-alpha.1 <0.2.0 || >=0.2.0-rc.2 <0.3.0`、`@deepseek-ai/schemastery >=3.18.3 <4.0.0`。旧范围（`^0.1.0-rc.6`）在新运行时下会装出与宿主不一致的旧包版本。
- **`JsonValue` 类型改从 `@deepseek-ai/dsh-util-values` 导入**：该类型在 0.1.7 线从 `@deepseek-ai/dsh-session` 迁移，旧导入路径在新版已不存在。
- **开发工具链切换为 pnpm**（与 DSH 运行时安装器一致）：npm 的 peer 自动解析会顺着上游 `^0.1.7-alpha.1` 范围把 `dsh-invariants`、`dsh-brand` 等拉成 0.1.7-rc.x（要求 cordis ~4.0.4），与 4.0.3 运行时冲突；pnpm 精确锁定可复现运行时环境。devDeps 全部精确锁定到 0.1.7-alpha.1（cordis 4.0.3 / schemastery 3.18.3 / cosmokit 1.8.4 / zod 4.6.5）。

### Added

- **时间语义（Phase 1）**：
  - **软失效**：`memory_update` 新增 `mode=invalidate`（+ `reason`）——被取代的记忆不删除，而是带上失效时间与原因（文件格式 `<!-- invalid: <ISO> | <reason> -->`），保留在文件里供审计，但不再注入系统提示词、`memory_get` 默认也不再返回。对同一 key 重新 `set`/`append` 会复活该条。
  - **`staleAfterDays` 配置**（默认 `0` = 关闭）：N 天未更新的条目在提示词与 `memory_get` 中带 `[stale: last updated Nd ago]` 标注——仅标注、绝不自动删除；无时间戳的手写条目不判 stale。
  - **`memory_get(includeStale?)`**：`includeStale: true` 可取回失效条目（带失效时间 + 原因标记）用于审计"什么被取代了"；返回值新增 `invalidated` 计数。
  - **淘汰优先级**：超字节预算时失效条目最先被淘汰，为有效记忆让路。
- **记忆分层（Phase 2）**：
  - **工作区记忆层**：`memory_update(scope=workspace)` 把项目级知识（构建约定、架构、命令）写进按会话 `cwd` 定位的独立目录 `$DSH_HOME/user-memory/workspace/<sha256(realpath(cwd)) 前 16 位>/`，每个主题一个 Markdown 文件，并自动重建 `MEMORY.md` 索引（主题名 + 一行摘要）。工作区身份来自会话头部的 `cwd`，而非进程工作目录——同一个项目在任何 profile / 任何会话里共享，换项目自动隔离。
  - **懒加载注入**：系统提示词只注入当前工作区记忆的**索引**（默认 512 字节预算，`workspacePromptMaxBytes`），正文用 `memory_topic` 按需取——大记忆不烧每轮 token。工作区解析走 `AssembleContext.agent`（官方 `assembleContextFor` 提供的装配上下文），没有 agent 的装配（诊断场景）不注入。
  - **`memory_search(query?, limit?, includeStale?)`**：跨「全局画像 + 当前工作区记忆」的关键词检索——主题名命中 ×3、正文出现次数 ×1（上限 5）、全部检索词命中额外 +4，返回带一行摘要的有序结果；子串匹配使中文无需分词即可命中。向量召回刻意不引入（个人规模下文件检索足够，见 Roadmap）。
  - **`memory_topic(topic)`**：读取单个工作区主题的全文（含失效标记）。
  - 主题名做文件名安全校验（拒绝路径分隔符与 Windows 保留字符、禁止 `.` 开头、≤64 字符）；单主题正文上限 16 KiB，超限报错而非静默截断。
- **后台巩固 / "dreaming"（Phase 3）**：
  - **触发**：`autoConsolidate`（默认关闭）开启后，在每个 agent 回合边界（`agent/turn-stopping`）异步触发一次整理，`consolidateMinIntervalMs` 去抖（默认 10 分钟），且**不阻塞回合**（fire-and-forget，后台异常绝不外泄进会话）；也可随时手动调用 `memory_consolidate`。
  - **确定性整理（不需要模型）**：① 重复合并——值归一化（忽略大小写与空白）后保留最新一条，其余软失效并附原因；② 相对时间锚定——含「今天/明天/上周/today/tomorrow/next week」等相对时间的条目**追加**一行绝对记录日期（只加一次，绝不改写用户原话）；③ 老化——超过 `staleAfterDays` 的条目写进运行记录，超过 `autoInvalidateAfterDays`（默认 0 = 关闭）的条目自动软失效。
  - **模型辅助整理（可选）**：配置 `consolidateProvider` + `consolidateModel` 后，用一次独立模型调用（不写入会话记录，属 sleep-time compute 语义）产出 ops（`add` / `merge` / `rewrite` / `invalidate` / `topic-add` / `topic-invalidate`），逐个校验后与确定性 ops 按操作标签去重合并执行；模型未配置、调用失败或返回非法 JSON 时降级为确定性结果，并在工具输出与日志里说明原因。插件**不硬依赖** `llm` 服务（用 `ctx.get('llm')` 可选获取），未挂载时该层自动关闭、其余功能不受影响。
  - **审计日志**：每次运行追加到 `$DSH_HOME/user-memory/consolidation-log.md`（可用 `consolidationLogPath` 覆盖）——时间、触发源（`manual` / `turn`）、工作区路径、逐条 `applied` / `skipped` 及原因、老化候选。日志写入失败不会回滚记忆写入。
  - **`memory_consolidate(mode?, useModel?)`**：`mode=plan`（默认）只报告将要执行的 ops（不落盘、不写日志），`mode=apply` 才执行并写日志。

### Removed

- 对 DSH 0.1.0–0.1.6 版本线的兼容（该线 peer 组合已不在新范围覆盖内）。

### Verified

- 68/68 测试通过 @ **0.1.7-alpha.1** 依赖线（与 2026-09-22 后的官方桌面/网页运行时一致）。
- 68/68 测试通过 @ **0.2.0-rc.2** 依赖线（cordis 4.0.4 / schemastery 3.18.4 / cosmokit 1.8.5 / 全部 dsh-* 0.2.0-rc.2），`tsc` 构建同样零报错——确认代码同时兼容 0.1.7-alpha.x 与 0.2.0-rc.x 两条运行时线。
- 新增 41 个测试（11 → Phase 1，14 → Phase 2，16 → Phase 3）：
  - Phase 1：失效/复活 round-trip（含 reason 内 `|` 字符）、reason 单行化与长度上限、失效未知 key 报错、stale 判定阈值/开关/无时间戳、失效与 stale 标注渲染、失效条目优先淘汰，以及 Context 级验证（失效条目离开提示词、`includeStale` 审计、复活回归、`staleAfterDays` 提示词标注）。
  - Phase 2：主题文件 round-trip（含转义行与失效标记）、主题名校验、索引重建（失效主题不入索引、新近优先）、检索评分与排序（含中文子串、`includeStale` 标记）、工作区存储 set/append/invalidate/remove、超限拒绝、同一 `cwd` 身份稳定、同步索引读取，以及 Context 级验证（`scope=workspace` 经真实工具注册表落盘、无 agent 时的清晰报错、`memory_search` 跨层检索与 `memory_topic` 全文、索引只对携带 agent 的装配注入且按工作区隔离、`workspacePromptMaxBytes=0` 关闭注入）。
  - Phase 3：值归一化、重复合并（最新保留）、相对时间锚定（只锚一次、不改写原话）、老化候选与自动失效、工作区主题重复合并、模型答案解析（代码围栏/截断 JSON/非法 op 丢弃/`merge` 自指丢弃）、请求构造契约、模型流式取回与调用失败降级、`applyPlan` 落盘与幂等、工作区 op 与无工作区时的跳过、`skipped` 原因、日志追加（表头 + 多次运行共存）、计划/执行/模型错误三种摘要，以及 Context 级验证（`memory_consolidate` 的 plan 不落盘不写日志 / apply 落盘并写日志、`useModel` 经真实 `ctx.llm` 与 stub adapter 写入模型提出的条目、未配置模型时的清晰降级），外加循环级验证（真实 AgentLoop 回合边界异步触发一次后台整理并落日志）。

### 三轴验收对比（OpenAI 记忆评估三轴）

对照 OpenAI 的记忆评估三轴——**事实回忆 / 偏好遵循 / 随时间保持正确**——0.1.x 与 0.2.0 的能力差异，以及每一轴对应的可验证证据：

| 评估轴 | 0.1.x（改造前） | 0.2.0（改造后） | 证据 |
|---|---|---|---|
| **事实回忆**（记得住、找得回） | 只有全量画像注入 + `memory_get`；条目一多，每轮注入被预算裁掉，旧事实要靠模型主动调工具才看得到 | 分层 + 检索：全局画像、工作区记忆索引注入、`memory_search`（关键词评分：主题名 ×3、正文次数 ×1 上限 5、全词命中 +4）、`memory_topic` 懒加载全文；子串匹配使中文无需分词 | 检索评分/排序/中文命中用例；harness 跨层检索（global + workspace）与全文读取用例 |
| **偏好遵循**（按你的偏好行事） | 画像注入 + "参考数据不是指令"护栏（0.1.1）；被取代的偏好只能**硬删除**，模型看不到"曾经如此" | 软失效：`mode=invalidate` + `reason`，失效条目**离开提示词**但留在文件里可审计；`set`/`append` 复活；重复偏好自动合并 | 失效/复活 round-trip、失效离开提示词、`includeStale` 审计、重复合并用例 |
| **随时间保持正确** | 无时间语义：条目只有写入时间戳（0.1.2 起仅用于淘汰顺序），提示词里完全看不出新旧 | 逐条 `updatedAt` 参与渲染 + `[stale: last updated Nd ago]` 标注（`staleAfterDays`）；后台整理做相对时间锚定与自动老化失效；每次运行都有审计日志 | `isStale` 阈值/开关/无时间戳用例、stale 标注渲染用例、时间锚定与 auto-aging 用例、回合边界后台运行用例 |

结论：三轴各自被一组明确机制补齐（分层检索 → 事实回忆；软失效/复活 → 偏好遵循；老化标注 + 后台时间锚定 → 时间正确性），每项都有对应测试与可审计日志，**不依赖"模型自觉"**。

## [0.1.2] — 2026-08-15

### Fixed

- **`##` 行破坏档案的 round-trip bug**：以前值里若含一行以 `## ` 开头的文本（例如 Markdown 小标题），下次读取会被误判成新 key，条目被静默拆分。现在序列化时对以 `#`、`\`、`<` 开头的值行做前置 `\` 转义，读取时还原，`parseProfile`/`serializeProfile` 严格 round-trip。
- **截断标记污染条目 + 中段条目静默丢失**：旧版 `truncateBytes` 按字节砍文档，截断标记会被吞进前一个条目的值，且被砍掉哪些 key 完全不可见。现在改为**按条目淘汰**：超限时按最旧优先丢弃整条，`memory_update` 结果返回 `evicted`（被淘汰的 key）；单条仍超限时才截断该条的值（带可见标记），绝不静默丢失。
- **key 校验**：拒绝空 key、含换行的 key、超长 key（128 字符），避免写出畸形文档。

### Added

- **逐条时间戳**：每条记录带 `<!-- ts: <ISO 8601> -->` 元数据，用于淘汰与排序；旧档案（无时间戳）按最旧处理，向后兼容。
- **`promptMaxBytes` 配置**（默认 2048）：每轮系统提示词注入按**新近度优先**、以字节预算裁剪，超出的条目通过 `memory_get` 获取，大档案不再每轮烧 token；`0` 恢复注入完整画像。
- 提示词注入改为渲染干净的条目内容（不再把 `# User Memory` 标题、`updated-at` 保留键、时间戳注释一并塞进提示词）。

### Changed

- `maxBytes` 语义从"保头保尾截断"改为"最旧优先逐条淘汰"。
- 测试从 21 个增加到 27 个：新增转义 round-trip、逐条时间戳、淘汰顺序、单条截断、预算注入等用例。

## [0.1.1] — 2026-08-14

### Fixed

- **"复读档案"僵硬问题**：系统提示词注入新增使用指南——agent 应把画像**内化为对用户的理解**（用于自然个性化语气/语言/框架），**除非用户主动询问，不得复读/引用/总结画像**。之前画像只被标注为"参考数据"，导致新会话的 agent 倾向于把档案原样背诵成表格。

### Changed

- README (中文 + English) rewritten as a complete user journey: project intro →
  install → verify → usage (remember / read / forget / cross-session demo) →
  where the memory lives → tool reference → development → roadmap.

## [0.1.0] — 2026-08-14

### Added

- `memory_get(query?, limit?)` and `memory_update(key, value, mode?)` model-facing
  tools, registered through `ctx.tools.register(defineTool(...))`.
- System-prompt injection via the `{{user_profile}}` prompt variable: every turn of
  every session carries the current user profile; an empty profile renders to an
  empty section, so there is zero token cost until something is recorded.
- Durable storage in a single Markdown file at `$DSH_HOME/user-memory/user.md`
  (configurable via `path`): atomic writes (tmp file + rename), owner-only
  permissions, `maxBytes` head/tail truncation, reserved `updated-at` key.
- Anti-prompt-injection framing: the injected profile is labelled reference data,
  not instructions (same stance as `dsh-session-reference` snapshots).
- Bundle activation: `cordis.patch.yml` + `dsh.bundle.patch` so `dsh plugin --profile <name> add dsh-tool-user-memory`
  installs AND activates the plugin as a profile layer.
- Test suite (21 tests): pure profile unit tests, real-file store integration
  tests, harness integration tests against a real cordis Context
  (`dsh-agent-loop-testkit`), and a full agent-loop test with a scripted LLM
  adapter (tool-call turn + final-answer turn).

### Verified

- `dsh plugin --profile headless add <tarball>` activates the bundle layer.
- A real headless session (dsh 0.1.0-rc.6, DeepSeek model) persisted a preference
  through `memory_update`.
- A brand-new session answered from the injected `{{user_profile}}` without
  calling any tool.

[0.2.1]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.2.1
[0.2.0]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.2.0
[0.1.2]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.1.2
[0.1.1]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.1.1
[0.1.0]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.1.0

[0.2.2]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.2.2
