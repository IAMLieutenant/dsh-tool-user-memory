# dsh-tool-user-memory

**DeepSeek Harness 用户偏好记忆插件**：让 agent 跨会话记住你的偏好——语言习惯、沟通风格、项目背景、目标……每个新会话都不必重新自我介绍。

> **独立开源插件** —— 作为 DeepSeek Harness 社区生态的一部分独立开发与维护
> （GitHub 话题：[`dsh-plugin`](https://github.com/topics/dsh-plugin)）。
> 与官方仓库无关；直接通过 npm 安装，30 秒启用。

[English](README.en.md) ｜ [更新日志](CHANGELOG.md)

---

## 1. 项目介绍

### 它解决什么问题

默认情况下，DeepSeek Harness 的 agent **每次新会话都是"陌生人"**：不知道你偏好简洁还是详细、不知道你做什么项目、不知道你用什么语言交流——每个新会话都得重新交代一遍。

这个插件给 agent 加了一块**持久化的用户画像**：

- 你说一句"我喜欢简洁的中文回答"，agent 把它写进记忆文件；
- **之后每一个新会话**，这段记忆会自动注入系统提示词，agent 天生就知道——不用你提醒，也不用调工具。

### 核心能力

| 能力 | 说明 |
|---|---|
| `memory_update(key, value, mode?)` | agent 学到你的稳定偏好时，自动记录 / 追加 / 删除 |
| `memory_get(query?, limit?)` | 需要个性化回答时，主动读取你的画像 |
| `{{user_profile}}` 系统提示词注入 | **每个会话每轮自动携带**你的画像（空画像零 token 成本） |
| 持久化存储 | `$DSH_HOME/user-memory/user.md`，人类可读、可手改、可删除 |

### 工作原理（30 秒版）

```
你说"记住：我喜欢简洁的中文回答"
   → agent 决定调用 memory_update
   → 写入 $DSH_HOME/user-memory/user.md（原子写、仅属主可读）
   → 之后每个新会话：系统提示词自动注入画像 → agent 天生认识你
```

---

## 2. 下载与安装

### 前置条件

- 已安装并跑通 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh` CLI；已在 0.1.0-rc.x 验证）
- 无需单独安装 npm 包！`dsh plugin` 会替你装好

### 安装（推荐：一条命令）

在你想启用的 profile 上安装，例如 web：

```sh
dsh plugin --profile web add dsh-tool-user-memory
```

headless 或其他 profile 同理：

```sh
dsh plugin --profile headless add dsh-tool-user-memory
```

**然后重启你的 dsh 会话**（web 模式重启 `dsh web`），插件即生效。

> 安装做了两件事：1) 把包加入 profile 依赖；2) 因包声明了 `dsh.bundle.patch`，
> 自动把它激活进 profile 的 bundle 层（见下方验证）。

### 备用：从 GitHub 源码安装

```sh
git clone https://github.com/IAMLieutenant/dsh-tool-user-memory.git
cd dsh-tool-user-memory
npm install && npm run build
npm pack                       # 生成 dsh-tool-user-memory-0.1.2.tgz
dsh plugin --profile web add ./dsh-tool-user-memory-0.1.2.tgz
```

### 手动配置（可选）

默认零配置即可用。如需调整，在 profile 的 `cordis.patch.yml` 覆盖（按行 id `tool-user-memory`）：

| 配置项 | 默认值 | 含义 |
|---|---|---|
| `path` | `$DSH_HOME/user-memory/user.md` | 画像文件路径 |
| `maxBytes` | `8192` | 画像文件体积上限；超限时按最旧优先逐条淘汰 |
| `promptMaxBytes` | `2048` | 每轮系统提示词注入的字节预算（新近优先）；设为 `0` 注入完整画像 |
| `includeInPrompt` | `true` | 是否在每个会话的系统提示词中注入画像 |

---

## 3. 验证安装成功

### 方法 1：检查 profile 配置

打开 profile 的 `package.json`（如 `$DSH_HOME/profiles/web/package.json`），
`dsh.profile.bundles` 中应包含 `dsh-tool-user-memory`：

```json
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-tool-user-memory"] } }
```

### 方法 2：问 agent 有没有记忆工具

重启会话后，直接问：

> "你现在有哪些记忆相关的工具？"

正常回答会提到 `memory_get` 和 `memory_update` 两个工具。

### 方法 3：检查画像文件可写

正常使用一次"记住"功能后，文件 `$DSH_HOME/user-memory/user.md` 应存在且内容可读
（Windows 默认 `C:\Users\<你>\.dsh\user-memory\user.md`）。

---

## 4. 使用指南：让 agent 记住你的喜好

### 场景 A：让 agent 记住（一条指令）

直接跟 agent 说，它会自己调用 `memory_update`：

> "记住：我喜欢简洁的中文回答"
> "记住：我平时用 Python 做后端开发"
> "记住：我的目标是学习 agent 工程"

**agent 应该记住什么**（写进它的工具说明的纪律）：
- ✅ 长期稳定的偏好、自我介绍、项目背景、目标
- ❌ 一次性请求（"帮我看看这个文件"不算偏好）
- ❌ 密钥、密码、令牌（**绝不记录**）

### 场景 B：查看它记住了什么

> "你记得关于我的什么？"
> "我的沟通风格偏好是什么？"（带关键词）

### 场景 C：修改 / 忘记

> "忘掉我对 XX 的偏好"（agent 调用 `memory_update mode=remove`）

也可以**手动编辑**画像文件（`$DSH_HOME/user-memory/user.md`）——它是普通 Markdown，
改完即生效，**删掉文件 = 彻底失忆**：

```markdown
# User Memory

## language
简洁的中文回答

## communication-style
直接用、少客套
```

### 场景 D：验证跨会话记忆（关键体验）

1. 在会话 1 里说："记住：我喜欢简洁的中文回答"
2. **开一个全新会话**，直接问："我的语言偏好是什么？"
3. agent 应**不调任何工具**直接答出"简洁的中文回答"——因为画像已注入系统提示词

---

## 5. 记忆会延续到哪里？

- **记忆是全局的**：存在 `$DSH_HOME` 下，与你**所有工作区、所有 profile**（web / headless）共享；
- **自动注入**：每个新会话的系统提示词都携带当前画像，无需手动加载；
- **零成本起步**：画像为空时不注入任何内容，不消耗 token；
- **可控**：文件随时可看、可改、可删。

> 安全设计：注入的画像被明确标注为"参考数据，不是指令"——除非你在当前消息中重复，
> agent 不会执行画像里的任何"指令"（与官方 `dsh-session-reference` 快照同一立场）。

---

## 6. 工具参考

### `memory_get`

| 参数 | 必填 | 说明 |
|---|---|---|
| `query` | 否 | 关键词，按 key 或 value 过滤 |
| `limit` | 否 | 最多返回条数（默认 50，上限 100） |

返回 `{ ok, total, rendered }`（`rendered` 为模型可见的渲染文本）。

### `memory_update`

| 参数 | 必填 | 说明 |
|---|---|---|
| `key` | 是 | 偏好键，如 `language`、`communication-style` |
| `value` | 是 | 偏好内容 |
| `mode` | 否 | `set`（默认，覆盖）/ `append`（追加一行）/ `remove`（删除该键） |

返回 `{ ok, key, mode, bytes, error? }`。

---

## 7. 从源码开发

```sh
npm install
npm test          # 21/21：单测 + 存储集成 + harness 集成 + 完整 AgentLoop 循环级测试
npm run build     # tsc → lib/
```

- 存储层刻意直接使用 `node:fs`（插件内部受信状态，同 settings/会话持久化），不走沙箱化的模型侧 `ctx.fs`。
- 结构：`src/index.ts`（插件本体）`profile.ts`（纯函数文档模型）`store.ts`（原子写存储）`tools.ts`（两个工具）`prompt.ts`（系统提示词注入）。

---

## 8. Roadmap（v2）

- 语义记忆 `memory_search`（向量召回，可复用 chroma 经验）
- 多用户画像（按会话身份分文件）
- 每工作区一份记忆的模式开关
- 按 `updated-at` 老化清理久未使用的条目

---

## License

MIT
