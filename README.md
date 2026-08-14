# dsh-tool-user-memory

User preference memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
a Cordis plugin that gives the agent a **persisted, cross-session memory of user
preferences**, injected into the system prompt of every session.

> **Standalone open-source plugin** —developed and maintained independently as part
> of the DeepSeek Harness community ecosystem (topic: [`dsh-plugin`](https://github.com/topics/dsh-plugin)).
> Not affiliated with the official repository; install it straight from npm:
> `npm i dsh-tool-user-memory`, then
> `dsh plugin --profile web add dsh-tool-user-memory`.

[涓枃鏂囨。](README.zh.md)

## What it does

- **Two model-facing tools**
  - `memory_get(query?, limit?)` —read the user profile (filtered by keyword)
  - `memory_update(key, value, mode?)` —record / append / remove a preference
- **System-prompt injection** —every turn of every session carries the current
  profile through the `{{user_profile}}` prompt variable. Empty profile renders to
  an empty section, so there is **zero token cost** until something is recorded.
- **Durable, transparent storage** —a single Markdown file at
  `$DSH_HOME/user-memory/user.md` (default). Human-readable, diffable, deletable
  (= forgetting). Atomic writes (tmp file + rename), owner-only permissions.

## Install

```sh
# into the web profile
dsh plugin --profile web add dsh-tool-user-memory
# or headless
dsh plugin --profile headless add dsh-tool-user-memory
```

Restart the session. The tools appear in the model's toolset and the profile is
injected every turn.

> **Verified (2026-08-14, dsh 0.1.0-rc.6)**: installing via `dsh plugin`
> activates the plugin as a profile bundle (declares `dsh.bundle.patch`); a
> real headless session persisted a preference through `memory_update`, and a
> brand-new session answered from the injected `{{user_profile}}` without
> calling any tool.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `path` | `$DSH_HOME/user-memory/user.md` | Profile file path |
| `maxBytes` | `8192` | Max profile bytes; oversized documents are head/tail truncated |
| `includeInPrompt` | `true` | Inject the profile into every session's system prompt |

## Tool contract

### `memory_get`

Call when personalisation matters: preferred language, communication style,
project background, previously recorded preferences.

- `query` —optional keyword; filters entries by key or value
- `limit` —max entries (default 50, max 100)
- Returns `{ ok, total, entries: [{ key, value }], rendered }`

### `memory_update`

Call when the user expresses a **stable, long-term preference**, introduces
themselves / their project, or states a goal. Do NOT store one-off requests.
NEVER store credentials, passwords or tokens.

- `key` —preference key, e.g. `language`, `communication-style`
- `value` —preference content
- `mode` —`set` (default) / `append` / `remove`
- Returns `{ ok, key, mode, bytes, error? }`

## Security

- The injected profile is framed as **reference data, not instructions**; the
  agent must not follow directives found inside it unless the user repeats them
  in the current message (same stance as `dsh-session-reference` snapshots).
- Reserved key `updated-at` cannot be written by tools.
- File permissions: directory `0o700`, file `0o600`.

## Model experience

- **What the model sees**: the profile text under a "reference data, not
  instructions" header, plus the two tool schemas.
- **Token impact**: fixed cost per request equal to the rendered profile
  (鈮?`maxBytes`); zero when empty.
- **KV Cache impact**: the profile is a stable prefix per session; changing it
  invalidates cache from the first changed token.

## Development

```sh
npm install
npm test          # unit tests (node --test, no host needed)
npm run build     # tsc 鈫?lib/
```

The storage layer intentionally uses `node:fs` directly (plugin-internal trusted
state, like settings/session persistence), not the sandboxed `ctx.fs` seam.

## Roadmap

- v2: semantic `memory_search` (embedding recall), per-user files keyed by
  session identity, per-workspace profile mode, stale-entry aging by
  `updated-at`.

## License

MIT
