# dsh-tool-user-memory

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的用户偏好记忆插件：
给 agent 一个**跨会话持久化的用户画像**，并在每个会话的每轮系统提示词中自动注入。

> **独立开源插件** —— 作为 DeepSeek Harness 社区生态的一部分独立开发与维护
> （GitHub 话题：[`dsh-plugin`](https://github.com/topics/dsh-plugin)）。
> 与官方仓库无关；直接通过 npm 安装：`npm i dsh-tool-user-memory`，然后
> `dsh plugin --profile web add dsh-tool-user-memory`。

[English](README.md)

## 功能

- **两个面向模型的工具**
  - `memory_get(query?, limit?)` — 读取用户画像（支持按关键词过滤）
  - `memory_update(key, value, mode?)` — 记录 / 追加 / 删除一条偏好
- **系统提示词注入** — 每个会话每轮都通过 `{{user_profile}}` 变量携带当前画像。
  画像为空时渲染为空段并自动消失，**在记录任何内容之前零 token 成本**。
- **持久、透明的存储** — 单个 Markdown 文件 `$DSH_HOME/user-memory/user.md`（默认）。
  人类可读、可 diff、可删除（删 = 失忆）。原子写（临时文件 + rename），仅属主可读写。

## 安装

```sh
# 装进 web profile
dsh plugin --profile web add dsh-tool-user-memory
# 或 headless
dsh plugin --profile headless add dsh-tool-user-memory
```

重启会话即可生效：工具进入模型的工具集，画像每轮注入提示词。

> **已验证（2026-08-14，dsh 0.1.0-rc.6）**：通过 `dsh plugin` 安装会把插件激活为
> profile bundle（包内声明 `dsh.bundle.patch`）；真实 headless 会话通过
> `memory_update` 持久化了偏好，且**全新会话**未调用任何工具即从注入的
> `{{user_profile}}` 中答出偏好。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `path` | `$DSH_HOME/user-memory/user.md` | 画像文件路径 |
| `maxBytes` | `8192` | 画像体积上限；超限按保头保尾截断 |
| `includeInPrompt` | `true` | 是否在每个会话的系统提示词中注入画像 |

## 工具约定

### `memory_get`

需要个性化回答时调用：语言偏好、沟通风格、项目背景、已记录的偏好。

- `query` — 可选关键词，按 key 或 value 过滤
- `limit` — 最多返回条数（默认 50，上限 100）
- 返回 `{ ok, total, rendered }`（`rendered` 为模型可见的渲染文本）

### `memory_update`

用户表达**长期稳定偏好**、自我介绍/介绍项目、或陈述目标时调用。不要记录一次性请求。
**绝不存储密钥、密码或令牌。**

- `key` — 偏好键，如 `language`、`communication-style`
- `value` — 偏好内容
- `mode` — `set`（默认）/ `append` / `remove`
- 返回 `{ ok, key, mode, bytes, error? }`

## 安全

- 注入的画像被明确框定为**参考数据而非指令**：除非用户在当前消息中重复，
  agent 不得执行画像内的任何指令（与 `dsh-session-reference` 快照的立场一致）。
- 保留键 `updated-at` 不允许被工具写入。
- 文件权限：目录 `0o700`，文件 `0o600`。

## 模型体验

- **模型看到的内容**：带"参考数据而非指令"头部的画像文本，加上两个工具的 schema。
- **Token 影响**：每次请求的固定成本等于渲染后的画像（≤ `maxBytes`）；为空时为零。
- **KV Cache 影响**：画像是会话内稳定前缀；变更会使缓存从第一个变化的 token 起失效。

## 开发

```sh
npm install
npm test          # 21/21 通过（单测 + 存储集成 + harness 集成 + 循环级）
npm run build     # tsc → lib/
```

存储层刻意直接使用 `node:fs`（插件内部的受信状态，与 settings/会话持久化一致），
不走沙箱化的模型侧 `ctx.fs` seam。

## Roadmap

- v2：语义 `memory_search`（向量召回）、按会话身份分用户文件、每工作区一份模式、
  按 `updated-at` 老化清理。

## License

MIT
