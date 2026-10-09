# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-10-09

适配 DSH 0.1.7 / 0.2.0-rc 版本线（2026-08-17 之后的全部运行时演进）。

### Changed

- **peer 依赖升级到新版本线**：`@deepseek-ai/cordis >=4.0.3 <5.0.0`、`@deepseek-ai/dsh-tools` 与 `@deepseek-ai/dsh-home-paths` `>=0.1.7-alpha.1 <0.2.0 || >=0.2.0-rc.2 <0.3.0`、`@deepseek-ai/schemastery >=3.18.3 <4.0.0`。旧范围（`^0.1.0-rc.6`）在新运行时下会装出与宿主不一致的旧包版本。
- **`JsonValue` 类型改从 `@deepseek-ai/dsh-util-values` 导入**：该类型在 0.1.7 线从 `@deepseek-ai/dsh-session` 迁移，旧导入路径在新版已不存在。
- **开发工具链切换为 pnpm**（与 DSH 运行时安装器一致）：npm 的 peer 自动解析会顺着上游 `^0.1.7-alpha.1` 范围把 `dsh-invariants`、`dsh-brand` 等拉成 0.1.7-rc.x（要求 cordis ~4.0.4），与 4.0.3 运行时冲突；pnpm 精确锁定可复现运行时环境。devDeps 全部精确锁定到 0.1.7-alpha.1（cordis 4.0.3 / schemastery 3.18.3 / cosmokit 1.8.4 / zod 4.6.5）。

### Removed

- 对 DSH 0.1.0–0.1.6 版本线的兼容（该线 peer 组合已不在新范围覆盖内）。

### Verified

- 27/27 测试通过 @ **0.1.7-alpha.1** 依赖线（与 2026-09-22 后的官方桌面/网页运行时一致）。
- 27/27 测试通过 @ **0.2.0-rc.2** 依赖线（cordis 4.0.4 / schemastery 3.18.4 / cosmokit 1.8.5），确认代码同时兼容两条线。
- 全部 27 个测试覆盖：profile round-trip/转义/淘汰、store 原子写/LRU、真实 cordis Context 下的工具注册与执行、系统提示词注入（空画像零 token、预算裁剪新近优先）、完整 agent-loop（脚本化 LLM 适配）。

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

[0.2.0]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.2.0
[0.1.2]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.1.2
[0.1.1]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.1.1
[0.1.0]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.1.0
