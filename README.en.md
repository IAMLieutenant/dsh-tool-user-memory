# dsh-tool-user-memory

**User preference memory for DeepSeek Harness**: a Cordis plugin that lets the
agent remember your preferences across sessions — language, communication style,
project background, goals. No need to re-introduce yourself in every new session.

> **Standalone open-source plugin** — developed and maintained independently as
> part of the DeepSeek Harness community ecosystem (topic:
> [`dsh-plugin`](https://github.com/topics/dsh-plugin)). Not affiliated with the
> official repository; install straight from npm and enable it in ~30 seconds.

[中文](README.md) ｜ [Changelog](CHANGELOG.md)

---

## 1. What it does

### The problem

By default a DeepSeek Harness agent is a "stranger" in every new session: it does
not know your preferences, your projects, or even your language. Every session
starts from scratch.

This plugin gives the agent a **persisted user profile**:

- You say "I prefer concise answers" — the agent writes it to a memory file;
- **Every subsequent session** the profile is injected into the system prompt,
  so the agent knows you from the start — no reminders, no tool calls needed.

### Capabilities

| Capability | Description |
|---|---|
| `memory_update(key, value, mode?, reason?)` | The agent records / appends / soft-invalidates / removes a stable preference it just learned |
| `memory_get(query?, limit?)` | The agent reads your profile when personalisation matters |
| `{{user_profile}}` system-prompt injection | **Every turn of every session** carries your profile (zero token cost while empty) |
| Durable storage | `$DSH_HOME/user-memory/user.md` — human-readable, editable, deletable |

### How it works (30 seconds)

```
You: "Remember: I prefer concise Chinese answers"
  → agent decides to call memory_update
  → writes to $DSH_HOME/user-memory/user.md (atomic write, owner-only)
  → every new session: profile injected into the system prompt → the agent knows you
```

---

## 2. Install

### Prerequisites

- A working [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
  (`dsh` CLI; verified on 0.1.7-alpha.x / 0.2.0-rc.x).
- No manual npm setup needed — `dsh plugin` installs the package for you.

### One command (recommended)

Install into the profile you use, e.g. web:

```sh
dsh plugin --profile web add dsh-tool-user-memory
```

headless or any other profile works the same way:

```sh
dsh plugin --profile headless add dsh-tool-user-memory
```

**Then restart your dsh session** (for web: restart `dsh web`) — the plugin activates on boot.

> The install does two things: 1) adds the package to the profile's dependencies;
> 2) because the package declares `dsh.bundle.patch`, it is automatically activated
> as a profile bundle layer (see verification below).

### Alternative: install from source

```sh
git clone https://github.com/IAMLieutenant/dsh-tool-user-memory.git
cd dsh-tool-user-memory
pnpm install --frozen-lockfile
pnpm run build
pnpm pack                       # produces dsh-tool-user-memory-0.2.0.tgz
dsh plugin --profile web add ./dsh-tool-user-memory-0.2.0.tgz
```

### Configuration (optional)

Zero config by default. To tweak, override the `tool-user-memory` row in the
profile's `cordis.patch.yml`:

| Key | Default | Meaning |
|---|---|---|
| `path` | `$DSH_HOME/user-memory/user.md` | Profile file path |
| `maxBytes` | `8192` | Max profile file bytes; oldest entries are evicted first when exceeded |
| `promptMaxBytes` | `2048` | Per-turn injection byte budget (newest first); `0` injects the full profile |
| `includeInPrompt` | `true` | Inject the profile into every session's system prompt |
| `staleAfterDays` | `0` | Entries not updated within N days get a `[stale: last updated Nd ago]` annotation (annotation only, never deleted); `0` = off |

---

## 3. Verify the installation

### Method 1 — check the profile manifest

Open the profile's `package.json` (e.g. `$DSH_HOME/profiles/web/package.json`);
`dsh.profile.bundles` must contain `dsh-tool-user-memory`:

```json
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-tool-user-memory"] } }
```

### Method 2 — ask the agent about its memory tools

After restarting, ask:

> "What memory-related tools do you have?"

A correct answer mentions `memory_get` and `memory_update`.

### Method 3 — check the profile file is writable

After using "remember" once, `$DSH_HOME/user-memory/user.md` should exist and be
readable (Windows default: `C:\Users\<you>\.dsh\user-memory\user.md`).

---

## 4. Usage guide: make the agent remember you

### Scenario A — tell the agent to remember (one line)

Just say it — the agent calls `memory_update` itself:

> "Remember: I prefer concise answers"
> "Remember: I do Python backend development"
> "Remember: my goal is to learn agent engineering"

**What the agent should store** (its tool description's discipline):
- ✅ Stable long-term preferences, self-introductions, project backgrounds, goals
- ❌ One-off requests ("look at this file" is not a preference)
- ❌ Credentials, passwords, tokens (**never**)

### Scenario B — see what it remembers

> "What do you remember about me?"
> "What is my communication-style preference?" (with a keyword)

### Scenario C — edit / forget

> "Forget my preference for X" (the agent calls `memory_update mode=remove`, hard delete)
> "I actually switched from project X to project Y" (the agent calls `memory_update mode=invalidate` + `reason`: soft invalidation — history kept, behaviour no longer affected)

You can also **hand-edit the profile file** (`$DSH_HOME/user-memory/user.md`) — it
is plain Markdown, changes take effect immediately, and **deleting the file wipes
the memory**:

```markdown
# User Memory

## language
Concise Chinese answers

## communication-style
Direct, minimal pleasantries
```

### Scenario D — verify cross-session memory (the key demo)

1. In session 1: "Remember: I prefer concise Chinese answers"
2. **Start a brand-new session** and ask: "What is my language preference?"
3. The agent answers **without calling any tool** — the profile is already in the
   system prompt.

---

## 5. Where does the memory live?

- **Global**: stored under `$DSH_HOME`, shared across **all workspaces and
  profiles** (web / headless).
- **Auto-injected**: every new session carries the current profile in its system
  prompt; nothing to load manually.
- **Zero-cost start**: nothing is injected while the profile is empty.
- **Under your control**: the file can be viewed, edited, or deleted at any time.

> Security: the injected profile is framed as *reference data, not instructions*;
> the agent must not follow directives inside it unless you repeat them in the
> current message (same stance as the official `dsh-session-reference` snapshots).

---

## 6. Tool reference

### `memory_get`

| Arg | Required | Description |
|---|---|---|
| `query` | no | Keyword; filters entries by key or value |
| `limit` | no | Max entries (default 50, max 100) |
| `includeStale` | no | `true` = also return invalidated entries (marked with invalidation time + reason), for auditing |

Returns `{ ok, total, invalidated, rendered }` (`rendered` is the model-facing text; with `staleAfterDays` set, stale entries carry a `[stale: ...]` annotation).

### `memory_update`

| Arg | Required | Description |
|---|---|---|
| `key` | yes | Preference key, e.g. `language`, `communication-style` |
| `value` | yes | Preference content (`""` is fine for `invalidate` / `remove`) |
| `mode` | no | `set` (default, replace/revive) / `append` (add a line) / `remove` (hard delete) / `invalidate` (soft invalidate) |
| `reason` | no | For `mode=invalidate`: why the memory is no longer correct; stored with the entry for audit |

Returns `{ ok, key, mode, bytes, error? }`. **Soft-invalidation semantics**: an invalidated entry stays in the file (auditable), leaves the prompt, and is hidden from `memory_get` by default (pass `includeStale: true` to retrieve it); calling `set` / `append` on the same key revives it.

---

## 7. Development

```sh
pnpm install
pnpm test           # 38/38: unit + storage integration + harness integration + full AgentLoop test
pnpm run build       # tsc → lib/
```

- The storage layer deliberately uses `node:fs` directly (plugin-internal trusted
  state, like settings / session persistence), not the sandboxed model-facing
  `ctx.fs` seam.
- Layout: `src/index.ts` (plugin) `profile.ts` (pure document model) `store.ts`
  (atomic-write storage) `tools.ts` (the two tools) `prompt.ts` (system-prompt injection).

---

## 8. Roadmap (v2)

The v2 roadmap follows the 2026-10 survey of memory architectures at OpenAI (Dreaming), Claude Code (layered auto-memory), Letta (sleep-time compute / filesystem benchmarks), Mem0, and Zep (bi-temporal invalidation):

- ✅ **Temporal semantics** (implemented in 0.2.0): soft invalidation (`mode=invalidate` + `reason`, history preserved, never deleted) + aging config `staleAfterDays` + `memory_get(includeStale)` audit, so memories "stay correct over time" (benchmarked against OpenAI's three axes: fact recall / preference adherence / temporal correctness)
- **Memory layering**: global profile (existing) + per-workspace memory (index + topic files, lazy-loaded, mirroring Claude Code auto-memory)
- **`memory_search`**: file-based search first (keyword + scoring); embedding recall only as an option past ~500 entries (Letta benchmark: plain file search already beats Mem0's graph approach at personal scale)
- **Background consolidation ("dreaming")**: triggered on session idle / compaction / schedule; a background LLM pass extracts, merges, rewrites time (future → past), and invalidates, writing an auditable consolidation log
- Per-user profiles (keyed by session identity)

---

## License

MIT
