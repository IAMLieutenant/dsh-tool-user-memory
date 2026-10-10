# dsh-tool-user-memory

[npm 版本][badge-npm] [GitHub Release][badge-release] [License MIT][badge-license] [DSH 兼容线][badge-dsh]

**DeepSeek Harness 用户偏好记忆插件**：让 agent 跨会话记住你的偏好 —— 语言习惯、沟通风格、项目背景、目标。每个新会话都不必重新自我介绍。

> **独立开源插件**。作为 DeepSeek Harness 社区生态的一部分独立开发与维护，见 GitHub 话题 [`dsh-plugin`][topic]。
> 与官方仓库无关；直接通过 npm 安装即可启用。

[English][readme-en] ｜ [更新日志][changelog] ｜ 最新版本 **0.2.2**，见 [Release v0.2.2][release-url]

### 和以前的版本有什么区别？

- **0.1.x**：一份所有项目共用的个人便签，记住你的语言、沟通习惯和背景。
- **0.2.0**：增加每个项目自己的笔记、按需查找正文，以及旧记忆的失效和整理功能。
- **0.2.1**：修复同时写入丢数据，以及整理日期刷新记忆年龄的问题。
- **0.2.2**：修复整理覆盖刚更新的内容、旧记录意外复活、项目主题重名导致丢失，以及容量限制失效。

**默认就能跨会话记忆；自动整理默认关闭，模型辅助整理还需要单独配置。** 升级到 0.2.2 不需要手动迁移已有记忆文件。

升级：

```sh
dsh plugin --profile web add dsh-tool-user-memory@0.2.2
```

把 `web` 换成你正在使用的 profile，安装后重启会话。

## 目录

| 章节 | 内容 |
|---|---|
| [1. 它解决什么问题][s1] | 问题、收益、前后对比 |
| [2. 核心能力][s2] | 五个工具、四条机制 |
| [3. 安装][s3] | 一条命令、源码安装、全部配置项 |
| [4. 验证安装][s4] | 三种确认方式 |
| [5. 使用指南][s5] | 记住、查看、修改、遗忘、整理 |
| [6. 记忆存在哪][s6] | 文件布局、生命周期、安全设计 |
| [7. 工具参考][s7] | 参数表与返回结构 |
| [8. 常见问题][s8] | 记忆没生效、体积上限、隐私 |
| [9. 从源码开发][s9] | 构建、测试、代码结构 |
| [10. Roadmap][s10] | v2 路线与已完成项 |

---

## 1. 它解决什么问题

默认情况下，DeepSeek Harness 的 agent **每次新会话都是陌生人**：不知道你偏好简洁还是详细、不知道你做什么项目、不知道你用哪种语言交流。每个新会话都得重新交代一遍。

这个插件给 agent 加了一块**持久化的用户画像**：

- 你说一句「我喜欢简洁的中文回答」，agent 把它写进记忆文件；
- **之后每一个新会话**，这段记忆都会自动注入系统提示词。不用你提醒，也不用它调工具。

### 前后对比

| 维度 | 默认的 agent | 装上本插件 |
|---|---|---|
| 新会话 | 每次都要重新自我介绍 | 自动带上你的画像，开口就对味 |
| 项目知识 | 换个项目就断片 | 按工作目录分层的项目记忆，换项目不串味 |
| 过时信息 | 要么留着误导，要么手动删掉 | 软失效：不再影响回答，但仍留在文件里可查 |
| 记忆膨胀 | 越大越挤占每轮提示词 | 注入有独立预算，超限按最旧淘汰，还能后台整理 |
| 可审计 | 记了什么、漏了什么全靠猜 | 记忆就是 Markdown；整理动作另有一份审计日志 |

### 工作原理

```
你说「记住：我喜欢简洁的中文回答」
  → agent 调用 memory_update
  → 写入 $DSH_HOME/user-memory/user.md，原子写，并在支持的系统上设置仅属主读写权限
  → 之后每个新会话：系统提示词自动注入画像，agent 天生认识你
```

---

## 2. 核心能力

### 五个工具

| 工具 | 做什么 |
|---|---|
| `memory_get` | 读取个人画像，可按关键词过滤 |
| `memory_update` | 记录 / 追加 / 软失效 / 删除一条记忆，可选择写入个人画像或项目记忆 |
| `memory_search` | 跨「个人画像 + 当前项目记忆」做关键词检索，返回带评分与一行摘要的结果 |
| `memory_topic` | 读取某个项目记忆主题的全文 |
| `memory_consolidate` | 整理记忆：合并重复、锚定相对时间、失效过时条目，并写审计日志 |

### 四条机制

| 机制 | 说明 |
|---|---|
| 系统提示词注入 | 每个会话每轮自动携带个人画像与当前项目记忆索引；两者都为空时零 token 成本 |
| 记忆分层 | 个人画像全局共享；项目记忆按会话所在目录隔离，只对在该目录打开的会话可见 |
| 时间语义 | 每条记忆带更新时间；可以软失效；可以配置老化标注 |
| 后台整理 | 回合边界异步整理，也可以手动触发；每次运行都写审计日志 |

> **0.2.0 新增**：记忆分层、时间语义、后台整理三块能力。详见 [更新日志][changelog]。

---

## 3. 安装

### 前置条件

- 已安装并跑通 [DeepSeek Harness][harness]，即 `dsh` CLI
- 本插件已在 **0.1.7-alpha.x** 与 **0.2.0-rc.x** 两条运行时线上验证：每条线各 92 项测试全绿
- 无需单独安装 npm 包，`dsh plugin` 会替你装好

### 一条命令

在你想启用的 profile 上安装，例如 web：

```sh
dsh plugin --profile web add dsh-tool-user-memory
```

headless 或其他 profile 同理：

```sh
dsh plugin --profile headless add dsh-tool-user-memory
```

**然后重启你的 dsh 会话**：web 模式重启 `dsh web`，插件即生效。

> 安装做了两件事：一是把包加入 profile 依赖；二是因包声明了 `dsh.bundle.patch`，
> 自动把它激活进 profile 的 bundle 层。

### 备用：从源码安装

```sh
git clone https://github.com/IAMLieutenant/dsh-tool-user-memory.git
cd dsh-tool-user-memory
pnpm install --frozen-lockfile
pnpm run build
pnpm pack                       # 生成 dsh-tool-user-memory-0.2.2.tgz
dsh plugin --profile web add ./dsh-tool-user-memory-0.2.2.tgz
```

### 配置项

`promptMaxBytes` 和 `workspacePromptMaxBytes` 限制的是注入的记忆正文，提示词里的说明文字另计。项目主题正文（含追加后的总内容）最多 16 KiB；`MEMORY` 和 Windows 保留文件名不能作为主题名。

默认零配置即可用。如需调整，在 profile 的 `cordis.patch.yml` 里按行 id `tool-user-memory` 覆盖：

| 配置项 | 默认值 | 含义 |
|---|---|---|
| `path` | `$DSH_HOME/user-memory/user.md` | 个人画像文件路径 |
| `maxBytes` | `8192` | 画像文件体积上限，超限时按最旧优先逐条淘汰 |
| `promptMaxBytes` | `2048` | 画像正文的硬字节上限，新近优先；单条过长会带标记截短，可用 memory_get 查看全文；`0` 注入完整画像 |
| `includeInPrompt` | `true` | 是否在每个会话的系统提示词中注入画像 |
| `staleAfterDays` | `0` | N 天未更新的条目带 `[stale: last updated Nd ago]` 标注，仅标注不删除；`0` 为关闭 |
| `workspacePromptMaxBytes` | `512` | 项目索引正文的硬字节上限，正文按需读取；`0` 为不注入项目记忆 |
| `workspaceBase` | `$DSH_HOME/user-memory/workspace` | 项目记忆根目录，主要用于测试或自定义布局 |
| `autoConsolidate` | `false` | 是否在回合边界后台自动整理记忆，去抖且不阻塞回合 |
| `consolidateMinIntervalMs` | `600000` | 两次自动整理的最小间隔；`0` 为每个回合边界都整理 |
| `autoInvalidateAfterDays` | `0` | 超过 N 天未更新的条目由整理自动软失效，仍留在文件里可审计；`0` 为不自动失效 |
| `consolidateProvider` | `''` | 可选的整理模型 provider，留空则只用确定性规则 |
| `consolidateModel` | `''` | 可选的整理模型 id |
| `consolidateMaxTokens` | `1024` | 单次整理模型调用的输出上限 |
| `consolidationLogPath` | `$DSH_HOME/user-memory/consolidation-log.md` | 整理审计日志路径 |

---

## 4. 验证安装

### 方法一：看 profile 清单

打开 profile 的 `package.json`，例如 `$DSH_HOME/profiles/web/package.json`，确认 `dsh.profile.bundles` 里出现了 `dsh-tool-user-memory`：

```json
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-tool-user-memory"] } }
```

### 方法二：问 agent 有哪些记忆工具

重启会话后直接问：

> 「你现在有哪些记忆相关的工具？」

正常回答会提到 `memory_get` 与 `memory_update`，0.2.0 还应提到 `memory_search`、`memory_topic`、`memory_consolidate`。

### 方法三：看画像文件

正常使用一次「记住」之后，`$DSH_HOME/user-memory/user.md` 应当存在且可读。Windows 下默认位置是 `C:\Users\<你>\.dsh\user-memory\user.md`。

---

## 5. 使用指南

### 场景 A：让 agent 记住

直接说，它会自己调用 `memory_update`：

> 「记住：我喜欢简洁的中文回答」
> 「记住：我平时用 Python 做后端开发」
> 「记住：我的目标是学习 agent 工程」

**agent 应该记住什么**，这条纪律写进了它的工具说明：

- 长期稳定的偏好、自我介绍、项目背景、目标
- 一次性请求不算，例如「帮我看看这个文件」
- 密钥、密码、令牌**绝不记录**

### 场景 B：查看它记住了什么

> 「你记得关于我的什么？」
> 「我的沟通风格偏好是什么？」

需要更细的检索时，agent 会用 `memory_search` 跨个人画像与当前项目记忆一起找。

### 场景 C：修改与遗忘

> 「忘掉我对 XX 的偏好」，agent 调用 `memory_update mode=remove`，硬删除
> 「我那个 XX 项目已经换成 YY 了」，agent 调用 `memory_update mode=invalidate` 并附上 `reason`，软失效：历史保留，但不再影响回答

软失效与硬删除的区别：失效条目仍然留在文件里，可以审计、可以复活；删除则会从文件里移除。

### 场景 D：项目级记忆

在某个工作目录里，让 agent 记住只属于这个项目的知识：

> 「记住：这个仓库只用 pnpm，提交前跑 pnpm test」

agent 会以 `scope=workspace` 写入。这份记忆只对该目录下打开的会话可见，换到别的项目不会串味。

### 场景 E：整理记忆

> 「帮我整理一下记忆」

agent 会先给方案后执行：`mode=plan` 只报告将要做的动作，`mode=apply` 才真正落盘并写日志。整理会合并重复条目、给相对时间补上绝对日期、按配置失效过时条目。

### 场景 F：验证跨会话记忆

1. 在会话 1 里说「记住：我喜欢简洁的中文回答」
2. **开一个全新会话**，直接问「我的语言偏好是什么？」
3. agent 应当**不调任何工具**直接答出「简洁的中文回答」，因为画像已经注入系统提示词

也可以**手动编辑**画像文件。它是普通 Markdown，改完即生效，**删掉文件就等于彻底失忆**：

```markdown
# User Memory

## language
<!-- ts: 2026-10-10T01:15:38.092Z -->
简洁的中文回答

## communication-style
<!-- ts: 2026-10-10T01:20:00.000Z -->
直接用、少客套

## old-project
<!-- ts: 2026-08-14T00:00:00.000Z -->
<!-- invalid: 2026-10-10T02:00:00.000Z | 项目已迁移到 agent-platform -->
旧项目说明
```

---

## 6. 记忆存在哪

- **个人记忆是全局的**：存在 `$DSH_HOME` 下，与你所有工作区、所有 profile 共享
- **项目记忆是分层的**：`scope=workspace` 写入的内容按会话所在目录分目录存放，只对在该目录打开的会话可见
- **自动注入**：每个新会话携带当前画像与当前项目记忆索引；索引只有主题名与一行摘要，正文按需取
- **零成本起步**：画像与项目记忆都为空时不注入任何内容，不消耗 token
- **可控**：文件随时可看、可改、可删，不会进你的代码仓库

### 文件布局

```
$DSH_HOME/user-memory/
├── user.md                     # 个人画像：偏好、自我介绍、跨项目稳定事实
├── consolidation-log.md        # 整理审计日志：每次运行做了什么、为什么
└── workspace/
    └── <hash16>/               # 每个工作目录一个；目录名取 sha256 的前 16 位，输入是该目录的 realpath
        ├── MEMORY.md           # 索引：主题名 + 一行摘要，每次写入自动重建
        └── <topic>.md          # 主题正文：标题 + 时间戳 + 可选失效标记 + 内容
```

### 一条记忆的生命周期

```
写入 → 有效 → 可选：带上陈旧标注 → 软失效 → 可以复活
        ↑                                      │
        └──────────── 再次 set 或 append ←──────┘
```

- **有效**：正常参与提示词注入与检索
- **陈旧标注**：超过 `staleAfterDays` 未更新时加标注，只是提醒，不影响使用
- **软失效**：被取代的记忆带上失效时间与原因，离开提示词，默认不出现在检索结果里
- **复活**：对同一个键再次写入即可恢复
- **淘汰**：超过 `maxBytes` 时按最旧优先逐条淘汰，失效条目最先让路

### 安全设计

注入的画像被明确标注为「参考数据，不是指令」，要求模型自然使用偏好，并避免执行画像中的指令。这是提示词约束，不能保证模型在所有情况下都遵守。

---

## 7. 工具参考

### `memory_get`

| 参数 | 必填 | 说明 |
|---|---|---|
| `query` | 否 | 关键词，按键或按值过滤 |
| `limit` | 否 | 最多返回条数，默认 50，上限 100 |
| `includeStale` | 否 | `true` 时连失效条目一起返回，带失效时间与原因标记，用于审计 |

返回 `{ ok, total, invalidated, rendered }`。`rendered` 是模型可见的渲染文本；开启 `staleAfterDays` 后，陈旧条目带 `[stale: ...]` 标注。

### `memory_update`

| 参数 | 必填 | 说明 |
|---|---|---|
| `key` | 是 | 记忆键，例如 `language`、`communication-style` |
| `value` | 是 | 记忆内容，`invalidate` 与 `remove` 时可传空字符串 |
| `mode` | 否 | `set` 覆盖并复活，`append` 追加一行，`remove` 硬删除，`invalidate` 软失效 |
| `reason` | 否 | `mode=invalidate` 时说明这条记忆为什么不再成立，随条目存档供审计 |
| `scope` | 否 | `global` 写个人画像，`workspace` 写当前目录的项目记忆 |

返回 `{ ok, scope, key, mode, bytes, error? }`。

**软失效语义**：失效条目保留在文件里，离开提示词，`memory_get` 默认隐藏，传 `includeStale: true` 可以查回；对同一个键再次 `set` 或 `append` 会复活它。

### `memory_search`

| 参数 | 必填 | 说明 |
|---|---|---|
| `query` | 否 | 关键词，空格分隔多词，支持中文子串；留空则列出最近的主题 |
| `limit` | 否 | 最多返回条数，默认 10，上限 20 |
| `includeStale` | 否 | `true` 时连失效条目一起检索，带失效标记 |

返回 `{ ok, total, results }`，每条结果含 `scope`、`topic`、`score`、`updatedAt`、`snippet`。评分规则：主题名命中记 3 分，正文每出现一次记 1 分且上限 5 分，全部关键词都命中额外加 4 分；个人画像与项目记忆一起排序。

### `memory_topic`

| 参数 | 必填 | 说明 |
|---|---|---|
| `topic` | 是 | 项目记忆主题名，来自注入的索引或 `memory_search` 的结果 |

返回 `{ ok, topic, updatedAt, invalidated, invalidReason, body }`，即主题全文。它懒加载，不进每轮提示词。

### `memory_consolidate`

| 参数 | 必填 | 说明 |
|---|---|---|
| `mode` | 否 | `plan` 只报告将要执行的整理动作，`apply` 执行并写审计日志 |
| `useModel` | 否 | 是否额外请求配置好的整理模型，需要先配置 provider 与 model |

整理做四件事：

1. **合并重复**：值归一化后相同的条目只留最新一条，其余软失效，并注明「与某条相同」
2. **锚定相对时间**：含「今天 / 明天 / 下周」等相对时间的条目追加一行绝对记录日期，只加一次，不改写你的原话
3. **老化**：超过 `staleAfterDays` 的条目进入运行记录，超过 `autoInvalidateAfterDays` 的条目自动软失效
4. **模型辅助**：用一次独立模型调用提出 `add`、`merge`、`rewrite`、`invalidate`、`topic-add`、`topic-invalidate` 操作，逐个校验后执行；模型不可用或返回非法内容时自动降级为确定性结果

每次运行都会追加到 `$DSH_HOME/user-memory/consolidation-log.md`，记录时间、触发源、逐条执行与跳过原因。**你随时能看到记忆被改了什么、为什么**。

---

## 8. 常见问题

**新会话里 agent 好像不知道我，怎么办？**

先确认 profile 的 `dsh.profile.bundles` 里有 `dsh-tool-user-memory`，再确认会话是在安装之后重启的。另一个常见原因是画像本来就是空的：**空画像不注入任何内容**，这是刻意的设计。

**记忆会不会越写越大，把每轮提示词撑爆？**

有两层预算。注入侧是 `promptMaxBytes`，默认 2048 字节，按新近优先裁剪；文件侧是 `maxBytes`，默认 8192 字节，超限按最旧优先逐条淘汰，失效条目最先让路。此外还可以开 `autoInvalidateAfterDays` 让整理自动失效长期未确认的条目。

**怎么彻底清空记忆？**

删掉 `$DSH_HOME/user-memory/user.md` 即可；项目记忆在 `$DSH_HOME/user-memory/workspace/` 下，按需删除对应目录。如需连整理操作记录也清除，请同时删除 `$DSH_HOME/user-memory/consolidation-log.md`。

**失效和删除到底该用哪个？**

被取代的用软失效：记录还在，可以审计、可以复活，但不再影响回答。确实不想留痕的才用删除。整理动作默认也只做软失效。

**会不会把我的密钥记进去？**

工具说明要求 agent 不记录密钥、密码和令牌，但插件没有自动识别所有敏感内容的过滤器。请勿让它保存凭据，也不要手写凭据到记忆文件。

**要联网或额外付费吗？**

默认不。绝大多数能力是纯本地的确定性逻辑，包括写入、检索、整理里的合并与老化。只有开启模型辅助整理时需要你配置 provider 与 model，那部分会正常消耗该模型的 token。

**项目记忆会跟着 git 走吗？**

不会。它存在 `$DSH_HOME` 下，不进你的代码仓库，也不会被提交。

**它和官方仓库是什么关系？**

没有关系。这是社区生态里的独立开源插件，按官方公开的插件接口实现。

---

## 9. 从源码开发

```sh
pnpm install
pnpm test           # 92/92：单测 + 锁原语 + 存储集成 + 项目记忆 + 后台整理 + harness 集成 + 完整 AgentLoop 循环级测试
pnpm run build      # tsc 编译到 lib/
```

- 测试覆盖工具接通与存储行为；循环测试使用固定模型响应，不代表真实模型的记忆效果已通过评估。
- 测试在当前依赖线全绿：`0.1.7-alpha.1` 与 `0.2.0-rc.2` 各 92 项
- 存储层刻意直接使用 `node:fs`，因为它属于插件内部受信状态，与 settings、会话持久化同类，不走沙箱化的模型侧 `ctx.fs`
- 代码结构：

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 插件本体：配置、装配、回合边界触发 |
| `src/profile.ts` | 个人画像的纯文档模型：解析、序列化、合并、淘汰、渲染、时效判定 |
| `src/store.ts` | 个人画像的原子写存储，含超限淘汰与时间戳保留式改写 |
| `src/lock.ts` | 读改写的并发保护：进程内串行加跨进程锁文件 |
| `src/workspace.ts` | 项目记忆层：主题文件、索引重建、关键词检索 |
| `src/consolidate.ts` | 后台整理：确定性规则、模型提案解析、执行与审计日志 |
| `src/tools.ts` | 五个模型可见工具 |
| `src/prompt.ts` | 提示词注入：画像与项目记忆索引 |

---

## 10. Roadmap

v2 路线来自 2026-10 对多个记忆架构的调研，包括 OpenAI 的记忆评估三轴、Claude Code 的自动记忆分层、Letta 的 sleep-time compute 与文件系统基准、Mem0、Zep 的双时态失效。

- ✅ **时间语义**，0.2.0 已实现：软失效、老化标注、`includeStale` 审计，让记忆随时间保持正确
- ✅ **记忆分层**，0.2.0 已实现：个人画像加项目记忆，索引注入、正文懒加载；项目身份取会话目录 realpath 的 sha256
- ✅ **文件检索优先**，0.2.0 已实现：关键词评分加一行摘要。向量召回留到条目量级很大时才考虑
- ✅ **后台整理**，0.2.0 已实现：回合边界异步触发加手动工具，确定性规则打底，可选模型辅助，全程审计日志
- **复盘式巩固**：用 subagent 读当前画像与会话摘要，产出结构化 diff，做语义级收敛，并支持每会话一次、短对话跳过、预算软上限
- **补齐触发方式**：会话空闲、compaction、定时任务
- **条目的创建时间**：为每条记忆单独记录首次写入时间
- 多用户画像，按会话身份分文件
- 以上待办与验收进度统一记录在 [issue #1][issue1]

---

## License

MIT

[badge-npm]: https://img.shields.io/npm/v/dsh-tool-user-memory
[badge-release]: https://img.shields.io/github/v/release/IAMLieutenant/dsh-tool-user-memory
[badge-license]: https://img.shields.io/badge/license-MIT-blue
[badge-dsh]: https://img.shields.io/badge/DSH-0.1.7%20%7C%200.2.0-blue

[npm-url]: https://www.npmjs.com/package/dsh-tool-user-memory
[release-url]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.2.2
[changelog]: CHANGELOG.md
[readme-en]: README.en.md
[topic]: https://github.com/topics/dsh-plugin
[harness]: https://github.com/deepseek-ai/deepseek-harness
[issue1]: https://github.com/IAMLieutenant/dsh-tool-user-memory/issues/1
[changelog-021]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.2.1

[s1]: #1-它解决什么问题
[s2]: #2-核心能力
[s3]: #3-安装
[s4]: #4-验证安装
[s5]: #5-使用指南
[s6]: #6-记忆存在哪
[s7]: #7-工具参考
[s8]: #8-常见问题
[s9]: #9-从源码开发
[s10]: #10-roadmap
