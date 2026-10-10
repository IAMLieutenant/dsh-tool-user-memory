# dsh-tool-user-memory

**User preference memory for DeepSeek Harness**: a Cordis plugin that lets the
agent remember your preferences across sessions — language, communication style,
project background, goals. No need to re-introduce yourself in every new session.

> **Standalone open-source plugin** — developed and maintained independently as
> part of the DeepSeek Harness community ecosystem (topic:
> [`dsh-plugin`](https://github.com/topics/dsh-plugin)). Not affiliated with the
> official repository; install straight from npm and enable it in ~30 seconds.

[中文](README.md) ｜ [Changelog](CHANGELOG.md) ｜ Latest **0.2.0** ([release](https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.2.0) · [npm](https://www.npmjs.com/package/dsh-tool-user-memory))

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
| `memory_update(key, value, mode?, reason?, scope?)` | The agent records / appends / soft-invalidates / removes a stable preference it just learned; `scope=workspace` writes project memory |
| `memory_get(query?, limit?, includeStale?)` | The agent reads your profile when personalisation matters |
| `memory_search(query?, limit?, includeStale?)` | Keyword search across the global profile **and** the current workspace's memory (scored, with one-line snippets) |
| `memory_topic(topic)` | Reads one workspace memory topic in full (lazy load) |
| `memory_consolidate(mode?, useModel?)` | Tidies memory: merges duplicates, anchors relative dates, retires stale facts, and writes an audit log |
| `{{user_profile}}` system-prompt injection | **Every turn of every session** carries your profile plus the current workspace memory index (zero token cost while both are empty) |
| Layered memory | Global profile + per-workspace memory (index + topic files) — all human-readable, editable, deletable |

> **New in 0.2.0**: layered memory (workspace memory + `memory_search` / `memory_topic`), temporal semantics (soft invalidation via `mode=invalidate` + `staleAfterDays` aging), and background consolidation (`memory_consolidate` + an auditable `consolidation-log.md`).
> See the [changelog](CHANGELOG.md) and [release 0.2.0](https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.2.0).

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
| `workspacePromptMaxBytes` | `512` | Per-turn byte budget for the injected workspace memory index (bodies stay lazy); `0` = no workspace injection |
| `workspaceBase` | `$DSH_HOME/user-memory/workspace` | Workspace memory root directory (mainly for testing or custom layouts) |
| `autoConsolidate` | `false` | Run a background tidy at turn boundaries (debounced, never blocks the turn) |
| `consolidateMinIntervalMs` | `600000` | Minimum interval between automatic runs; `0` = every turn boundary |
| `autoInvalidateAfterDays` | `0` | Consolidation soft-invalidates entries not updated for N days (they stay in the file for audit); `0` = never |
| `consolidateProvider` / `consolidateModel` | `''` | Optional model-assisted consolidation (empty = deterministic rules only) |
| `consolidateMaxTokens` | `1024` | Output cap for one consolidation model call |
| `consolidationLogPath` | `$DSH_HOME/user-memory/consolidation-log.md` | Audit log path |

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

- **Personal memory is global**: stored under `$DSH_HOME`, shared across **all
  workspaces and profiles** (web / headless).
- **Project memory is layered**: `scope=workspace` writes go to a directory keyed
  by the session's cwd (`sha256(realpath(cwd))`), visible only to sessions opened
  in that directory — no bleed between projects.
- **Auto-injected**: every new session carries the current profile plus the
  current workspace memory index in its system prompt (the index holds topic names
  and one-line summaries; bodies are fetched on demand with `memory_topic`).
- **Zero-cost start**: nothing is injected while both are empty.
- **Under your control**: the files can be viewed, edited, or deleted at any time.

### Memory file layout

```
$DSH_HOME/user-memory/
├── user.md                     # global profile: personal preferences, cross-project facts
└── workspace/
    └── <hash16>/               # one per working directory (sha256(realpath(cwd)), first 16 hex)
        ├── MEMORY.md           # index: topic name + one-line summary (regenerated on every write)
        └── <topic>.md          # topic body: title + timestamp + optional invalidation marker + content
```

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
| `scope` | no | `global` (default, personal profile) / `workspace` (project memory for the session's directory, stored as topic files) |

Returns `{ ok, scope, key, mode, bytes, error? }`. **Soft-invalidation semantics**: an invalidated entry stays in the file (auditable), leaves the prompt, and is hidden from `memory_get` by default (pass `includeStale: true` to retrieve it); calling `set` / `append` on the same key revives it.

### `memory_search`

| Arg | Required | Description |
|---|---|---|
| `query` | no | Keyword(s), space-separated (CJK substrings work); empty = list recent topics |
| `limit` | no | Max results (default 10, max 20) |
| `includeStale` | no | `true` = also search invalidated entries (marked) |

Returns `{ ok, total, results: [{ scope, topic, score, updatedAt, snippet }] }`. Scoring: topic-name hit ×3, body occurrences ×1 (capped at 5), all terms matched +4; global and workspace hits are ranked together.

### `memory_topic`

| Arg | Required | Description |
|---|---|---|
| `topic` | yes | Workspace topic name (from the injected index or `memory_search` results) |

Returns `{ ok, topic, updatedAt, invalidated, invalidReason, body }` — the full topic text (lazy-loaded; it never enters the per-turn prompt).

### `memory_consolidate`

| Arg | Required | Description |
|---|---|---|
| `mode` | no | `plan` (default — report the ops) / `apply` (perform them and write the log) |
| `useModel` | no | Also ask the configured consolidation model (needs `consolidateProvider` + `consolidateModel`) |

**What consolidation does**:

1. **Merge duplicates** — entries whose values normalize to the same text keep only the newest; the rest are soft-invalidated with a "same value as X" reason;
2. **Anchor relative dates** — entries mentioning today/tomorrow/next week gain one absolute recorded-date line (added once; your own words are never rewritten);
3. **Aging** — entries past `staleAfterDays` are reported, entries past `autoInvalidateAfterDays` are soft-invalidated;
4. **Model assistance** (optional) — one auxiliary model call proposes `add`/`merge`/`rewrite`/`invalidate`/`topic-*` ops which are validated before use; an unavailable or malformed answer degrades to the deterministic result.

Every run is appended to `$DSH_HOME/user-memory/consolidation-log.md`: when it ran, what triggered it (manual / turn boundary), and each applied or skipped op with its reason — **you can always see what changed in your memory and why**.

---

## 7. Development

```sh
pnpm install
pnpm test           # 68/68: unit + storage integration + workspace memory + consolidation + harness integration + full AgentLoop test
pnpm run build       # tsc → lib/
```

- The storage layer deliberately uses `node:fs` directly (plugin-internal trusted
  state, like settings / session persistence), not the sandboxed model-facing
  `ctx.fs` seam.
- Layout: `src/index.ts` (plugin) `profile.ts` (profile document model) `store.ts`
  (atomic-write profile store) `workspace.ts` (workspace memory: topic files + index
  + keyword search) `tools.ts` (the four tools) `prompt.ts` (profile + workspace index injection).

---

## 8. Roadmap (v2)

The v2 roadmap follows the 2026-10 survey of memory architectures at OpenAI (Dreaming), Claude Code (layered auto-memory), Letta (sleep-time compute / filesystem benchmarks), Mem0, and Zep (bi-temporal invalidation):

- ✅ **Temporal semantics** (implemented in 0.2.0): soft invalidation (`mode=invalidate` + `reason`, history preserved, never deleted) + aging config `staleAfterDays` + `memory_get(includeStale)` audit, so memories "stay correct over time" (benchmarked against OpenAI's three axes: fact recall / preference adherence / temporal correctness)
- ✅ **Memory layering** (implemented in 0.2.0): global profile + per-workspace memory (index + topic files, lazy-loaded, mirroring Claude Code auto-memory); workspace identity = `sha256(realpath(cwd))`, resolved automatically from the session's cwd
- ✅ **`memory_search`** (implemented in 0.2.0): file-based search first (keyword + scoring + one-line snippets); embedding recall only becomes worthwhile at a much larger scale (> ~500 entries; Letta benchmark: plain file search already beats Mem0's graph approach at personal scale)
- ✅ **Background consolidation ("dreaming")** (implemented in 0.2.0): asynchronous **at turn boundaries** (opt-in, debounced, never blocks the turn) plus a manual `memory_consolidate`; deterministic rules (duplicate merge / relative-date anchoring / aging) as the base, with optional model assistance (`consolidateProvider` + `consolidateModel`) proposing validated ops; every run lands in an auditable `consolidation-log.md`. **Not yet**: idle / scheduled triggers (the `schedule` subsystem) — tracked in [issue #2](https://github.com/IAMLieutenant/dsh-tool-user-memory/issues/2)
- Per-user profiles (keyed by session identity)

---

## License

MIT
