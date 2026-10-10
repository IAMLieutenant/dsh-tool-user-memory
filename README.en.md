# dsh-tool-user-memory

[npm version][badge-npm] [GitHub release][badge-release] [License MIT][badge-license] [DSH lines][badge-dsh]

**User preference memory for DeepSeek Harness**: a Cordis plugin that lets the agent remember your preferences across sessions — language, communication style, project background, goals. No need to re-introduce yourself in every new session.

> **Standalone open-source plugin**. Developed and maintained independently as part of the DeepSeek Harness community ecosystem, see the GitHub topic [`dsh-plugin`][topic].
> Not affiliated with the official repository; install straight from npm and it just works.

[中文][readme-zh] ｜ [Changelog][changelog] ｜ Latest **0.2.2**, see [release v0.2.2][release-url]

### What changed between versions?

- **0.1.x**: one shared personal note with your language, style, and background.
- **0.2.0**: separate project notes, on-demand reading, and memory retirement and tidying.
- **0.2.1**: fixes for lost concurrent writes and content edits resetting memory age.
- **0.2.2**: fixes for stale tidying plans overwriting new facts, retired entries reviving, reserved topic names losing content, and byte limits being exceeded.

**Cross-session memory works by default. Automatic tidying is off by default; model-assisted tidying needs separate configuration.** Existing memory files require no manual migration.

Upgrade, then restart your session (replace `web` with your profile):

```sh
dsh plugin --profile web add dsh-tool-user-memory@0.2.2
```

## Contents

| Section | What is inside |
|---|---|
| [1. The problem it solves][s1] | Problem, payoff, before-and-after |
| [2. Capabilities][s2] | Five tools, four mechanisms |
| [3. Install][s3] | One command, source install, every config key |
| [4. Verify the install][s4] | Three ways to confirm |
| [5. Usage guide][s5] | Remember, inspect, edit, forget, tidy |
| [6. Where the memory lives][s6] | File layout, lifecycle, security stance |
| [7. Tool reference][s7] | Argument tables and return shapes |
| [8. FAQ][s8] | Memory not showing up, size limits, privacy |
| [9. Development][s9] | Build, test, code layout |
| [10. Roadmap][s10] | The v2 plan and what already shipped |

---

## 1. The problem it solves

By default a DeepSeek Harness agent is **a stranger in every new session**: it does not know whether you prefer terse or detailed answers, what you work on, or which language you speak. Every session starts from scratch.

This plugin gives the agent a **persisted user profile**:

- You say "I prefer concise answers" and the agent writes it to a memory file;
- **Every subsequent session** carries that memory in its system prompt. No reminders, and no tool call required.

### Before and after

| Aspect | A stock agent | With this plugin |
|---|---|---|
| A new session | You introduce yourself again | Your profile is already there, so the tone fits |
| Project knowledge | Forgotten as soon as you switch projects | Per-directory project memory, no bleed between projects |
| Outdated facts | Either misleading or manually deleted | Soft invalidation: no longer affects answers, still auditable |
| Memory growth | Bigger profile, more tokens every turn | Injection has its own budget, eviction is oldest-first, background tidying available |
| Auditability | What was stored or dropped is a guess | The memory is plain Markdown, and tidying writes its own log |

### How it works

```
You: "Remember: I prefer concise answers"
  → the agent calls memory_update
  → writes to $DSH_HOME/user-memory/user.md, atomically, owner-only
  → every new session: the profile is injected into the system prompt
```

---

## 2. Capabilities

### Five tools

| Tool | What it does |
|---|---|
| `memory_get` | Reads the personal profile, optionally filtered by keyword |
| `memory_update` | Records, appends, soft-invalidates or removes one memory, either in the personal profile or in project memory |
| `memory_search` | Keyword search across the personal profile **and** the current project memory, returning scored hits with one-line snippets |
| `memory_topic` | Reads one project memory topic in full |
| `memory_consolidate` | Tidies memory: merges duplicates, anchors relative dates, retires stale entries, and writes an audit log |

### Four mechanisms

| Mechanism | What it means |
|---|---|
| System-prompt injection | Every turn of every session carries the personal profile plus the current project memory index; zero token cost while both are empty |
| Layered memory | The personal profile is global; project memory is isolated per session directory and visible only to sessions opened there |
| Temporal semantics | Every entry carries an update time; entries can be soft-invalidated; aging annotations are configurable |
| Background tidying | Runs asynchronously at turn boundaries, or on demand; every run leaves an audit log |

> **New in 0.2.0**: layered memory, temporal semantics and background tidying. See the [changelog][changelog].

---

## 3. Install

### Prerequisites

- A working [DeepSeek Harness][harness] with the `dsh` CLI
- This plugin is verified on both runtime lines, **0.1.7-alpha.x** and **0.2.0-rc.x**, with 92 tests green on each
- No manual npm step: `dsh plugin` installs the package for you

### One command

Install into the profile you use, for example web:

```sh
dsh plugin --profile web add dsh-tool-user-memory
```

headless or any other profile works the same way:

```sh
dsh plugin --profile headless add dsh-tool-user-memory
```

**Then restart your dsh session**: for web, restart `dsh web`, and the plugin activates.

> The install does two things: it adds the package to the profile dependencies, and because the
> package declares `dsh.bundle.patch`, it also activates the plugin as a profile bundle layer.

### Alternative: install from source

```sh
git clone https://github.com/IAMLieutenant/dsh-tool-user-memory.git
cd dsh-tool-user-memory
pnpm install --frozen-lockfile
pnpm run build
pnpm pack                       # produces dsh-tool-user-memory-0.2.2.tgz
dsh plugin --profile web add ./dsh-tool-user-memory-0.2.2.tgz
```

### Configuration

`promptMaxBytes` and `workspacePromptMaxBytes` cap injected memory content; explanatory prompt text is additional. A project topic body, including appended content, may be at most 16 KiB. `MEMORY` and Windows device names are reserved.

Zero config by default. To tweak anything, override the `tool-user-memory` row in the profile's `cordis.patch.yml`:

| Key | Default | Meaning |
|---|---|---|
| `path` | `$DSH_HOME/user-memory/user.md` | Personal profile file path |
| `maxBytes` | `8192` | Profile file size cap; entries are evicted oldest-first when exceeded |
| `promptMaxBytes` | `2048` | Hard byte limit for injected profile content, newest first; oversized entries are visibly truncated, available in full via memory_get; `0` injects the full profile |
| `includeInPrompt` | `true` | Whether to inject the profile into every session's system prompt |
| `staleAfterDays` | `0` | Entries not updated within N days get a `[stale: last updated Nd ago]` annotation; annotation only, never a deletion; `0` disables it |
| `workspacePromptMaxBytes` | `512` | Hard byte limit for injected project index content; bodies are read on demand; `0` disables project injection |
| `workspaceBase` | `$DSH_HOME/user-memory/workspace` | Project memory root directory, mainly for tests or custom layouts |
| `autoConsolidate` | `false` | Whether to tidy memory in the background at turn boundaries, debounced and never blocking |
| `consolidateMinIntervalMs` | `600000` | Minimum interval between automatic runs; `0` means every turn boundary |
| `autoInvalidateAfterDays` | `0` | Tidying soft-invalidates entries not updated for N days, keeping them in the file for audit; `0` disables it |
| `consolidateProvider` | `''` | Optional provider for model-assisted tidying; empty means deterministic rules only |
| `consolidateModel` | `''` | Optional model id for model-assisted tidying |
| `consolidateMaxTokens` | `1024` | Output cap for one tidying model call |
| `consolidationLogPath` | `$DSH_HOME/user-memory/consolidation-log.md` | Audit log path |

---

## 4. Verify the install

### Method 1: check the profile manifest

Open the profile's `package.json`, for example `$DSH_HOME/profiles/web/package.json`, and confirm that `dsh.profile.bundles` contains `dsh-tool-user-memory`:

```json
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-tool-user-memory"] } }
```

### Method 2: ask the agent which memory tools it has

After restarting, ask:

> "What memory-related tools do you have?"

A correct answer mentions `memory_get` and `memory_update`; on 0.2.0 it should also mention `memory_search`, `memory_topic` and `memory_consolidate`.

### Method 3: look at the profile file

After using "remember" once, `$DSH_HOME/user-memory/user.md` should exist and be readable. On Windows the default location is `C:\Users\<you>\.dsh\user-memory\user.md`.

---

## 5. Usage guide

### Scenario A: make the agent remember

Just say it and the agent calls `memory_update` itself:

> "Remember: I prefer concise answers"
> "Remember: I do Python backend development"
> "Remember: my goal is to learn agent engineering"

**What the agent should store**, a discipline written into its tool description:

- Stable long-term preferences, self-introductions, project background, goals
- Not one-off requests, such as "look at this file for me"
- Never credentials, passwords or tokens

### Scenario B: inspect what it remembers

> "What do you remember about me?"
> "What is my communication-style preference?"

For finer retrieval the agent uses `memory_search`, which covers the personal profile and the current project memory together.

### Scenario C: edit and forget

> "Forget my preference for X", and the agent calls `memory_update mode=remove`, a hard delete
> "I switched from project X to project Y", and the agent calls `memory_update mode=invalidate` with a `reason`, a soft invalidation: the history stays, but it no longer affects answers

Soft invalidation versus hard deletion: an invalidated entry stays in the file, so it remains auditable and can be revived, while a deletion removes it from the file.

### Scenario D: project memory

Inside a working directory, ask the agent to remember knowledge that belongs to that project only:

> "Remember: this repo uses pnpm only, run pnpm test before committing"

The agent writes it with `scope=workspace`. That memory is visible only to sessions opened in that directory, so other projects stay clean.

### Scenario E: tidy the memory

> "Tidy up my memory"

The agent reports first and acts second: `mode=plan` only lists the operations, `mode=apply` performs them and writes the log. Tidying merges duplicate entries, adds absolute dates next to relative ones, and retires stale entries according to configuration.

### Scenario F: verify cross-session memory

1. In session 1, say "Remember: I prefer concise answers"
2. **Start a brand-new session** and ask "What is my language preference?"
3. The agent should answer **without calling any tool**, because the profile is already in the system prompt

You can also **hand-edit the profile file**. It is plain Markdown, changes take effect immediately, and **deleting the file wipes the memory**:

```markdown
# User Memory

## language
<!-- ts: 2026-10-10T01:15:38.092Z -->
Concise answers

## communication-style
<!-- ts: 2026-10-10T01:20:00.000Z -->
Direct, minimal pleasantries

## old-project
<!-- ts: 2026-08-14T00:00:00.000Z -->
<!-- invalid: 2026-10-10T02:00:00.000Z | migrated to agent-platform -->
Notes about the old project
```

---

## 6. Where the memory lives

- **Personal memory is global**: stored under `$DSH_HOME` and shared across all workspaces and profiles
- **Project memory is layered**: `scope=workspace` writes go to a per-directory location and are visible only to sessions opened there
- **Auto-injected**: every new session carries the personal profile plus the current project memory index; the index holds topic names and one-line summaries, while bodies are fetched on demand
- **Zero-cost start**: nothing is injected while both are empty
- **Under your control**: the files can be viewed, edited or deleted at any time, and they never enter your code repository

### File layout

```
$DSH_HOME/user-memory/
├── user.md                     # personal profile: preferences, self-introduction, cross-project facts
├── consolidation-log.md        # audit log: what each tidying run changed, and why
└── workspace/
    └── <hash16>/               # one per working directory; the name is the first 16 hex of sha256 over that directory's realpath
        ├── MEMORY.md           # index: topic names plus one-line summaries, rebuilt on every write
        └── <topic>.md          # topic body: title, timestamp, optional invalidation marker, content
```

### The lifecycle of one memory

```
write → valid → optional: aging annotation → soft-invalidated → revivable
          ↑                                            │
          └──────────── set or append again ←──────────┘
```

- **Valid**: participates normally in prompt injection and search
- **Aging annotation**: added once an entry has not been updated for `staleAfterDays`; it is a hint, not a restriction
- **Soft-invalidated**: the entry keeps its invalidation time and reason, leaves the prompt, and is hidden from search by default
- **Revived**: writing to the same key brings it back
- **Evicted**: past `maxBytes`, entries are dropped oldest-first, and invalidated ones make way first

### Security stance

The injected profile is framed as *reference data, not instructions*. The prompt asks the model to use preferences naturally and ignore embedded directives. This is a prompt constraint, not a guarantee of model behavior.

---

## 7. Tool reference

### `memory_get`

| Argument | Required | Description |
|---|---|---|
| `query` | no | Keyword, filters entries by key or by value |
| `limit` | no | Maximum entries, default 50, cap 100 |
| `includeStale` | no | `true` also returns invalidated entries with their invalidation time and reason, for auditing |

Returns `{ ok, total, invalidated, rendered }`. `rendered` is the model-facing text; with `staleAfterDays` enabled, stale entries carry a `[stale: ...]` annotation.

### `memory_update`

| Argument | Required | Description |
|---|---|---|
| `key` | yes | Memory key, for example `language` or `communication-style` |
| `value` | yes | Memory content; an empty string is fine for `invalidate` and `remove` |
| `mode` | no | `set` replaces and revives, `append` adds a line, `remove` hard-deletes, `invalidate` soft-invalidates |
| `reason` | no | For `mode=invalidate`, why the memory no longer holds; stored with the entry for audit |
| `scope` | no | `global` writes the personal profile, `workspace` writes this directory's project memory |

Returns `{ ok, scope, key, mode, bytes, error? }`.

**Soft-invalidation semantics**: an invalidated entry stays in the file, leaves the prompt, and is hidden from `memory_get` by default; pass `includeStale: true` to read it back, and `set` or `append` on the same key revives it.

### `memory_search`

| Argument | Required | Description |
|---|---|---|
| `query` | no | Keywords, space separated, CJK substrings supported; empty lists the most recent topics |
| `limit` | no | Maximum results, default 10, cap 20 |
| `includeStale` | no | `true` also searches invalidated entries, marked as such |

Returns `{ ok, total, results }`, where each result carries `scope`, `topic`, `score`, `updatedAt` and `snippet`. Scoring: a topic-name hit is worth 3 points, each body occurrence 1 point capped at 5, and matching every keyword adds 4 more; personal and project hits are ranked together.

### `memory_topic`

| Argument | Required | Description |
|---|---|---|
| `topic` | yes | Project memory topic name, taken from the injected index or from `memory_search` results |

Returns `{ ok, topic, updatedAt, invalidated, invalidReason, body }`, the full topic text. It is lazy-loaded and never enters the per-turn prompt.

### `memory_consolidate`

| Argument | Required | Description |
|---|---|---|
| `mode` | no | `plan` only reports the operations, `apply` performs them and writes the audit log |
| `useModel` | no | Whether to also ask the configured tidying model; requires a configured provider and model |

Tidying does four things:

1. **Merge duplicates**: entries whose values normalize to the same text keep only the newest; the rest are soft-invalidated with a note saying which entry they duplicate
2. **Anchor relative dates**: entries mentioning today, tomorrow or next week gain one absolute recorded-date line, added once, without rewriting your own words
3. **Aging**: entries past `staleAfterDays` are reported, entries past `autoInvalidateAfterDays` are soft-invalidated
4. **Model assistance**: one auxiliary model call proposes `add`, `merge`, `rewrite`, `invalidate`, `topic-add` and `topic-invalidate` operations, each validated before use; an unavailable model or a malformed answer degrades to the deterministic result

Every run is appended to `$DSH_HOME/user-memory/consolidation-log.md`, recording the time, what triggered it, and each applied or skipped operation with its reason, so **you can always see what changed in your memory and why**.

---

## 8. FAQ

**The agent seems not to know me in a new session. What now?**

First confirm that `dsh.profile.bundles` in your profile lists `dsh-tool-user-memory`, then confirm the session was started after the install. Another common cause is an empty profile: **an empty profile injects nothing**, which is deliberate.

**Will the memory grow until it crowds out every prompt?**

There are two budgets. On the injection side, `promptMaxBytes` defaults to 2048 bytes and keeps the newest entries; on the file side, `maxBytes` defaults to 8192 bytes and evicts oldest-first, with invalidated entries making way first. You can also enable `autoInvalidateAfterDays` so tidying retires entries that were never confirmed again.

**How do I erase everything?**

Delete `$DSH_HOME/user-memory/user.md`; project memory lives under `$DSH_HOME/user-memory/workspace/`, so delete the directory you no longer want. To also erase the tidying history, delete `$DSH_HOME/user-memory/consolidation-log.md`.

**Should I invalidate or delete?**

Use soft invalidation for anything superseded: the record stays, remains auditable, and can be revived, yet it no longer affects answers. Delete only what you truly do not want on disk. Tidying defaults to soft invalidation as well.

**Could my credentials end up in there?**

The tool description tells the agent never to store credentials, passwords or tokens. The plugin does not automatically detect every secret. Do not ask it to save credentials or put them in memory files manually.

**Does it need network access or extra spending?**

By default, no. Almost everything is local and deterministic, including writes, search, and the merging and aging parts of tidying. Only model-assisted tidying calls a model, and only when you configure a provider and model, which consumes that model's tokens as usual.

**Does project memory travel with git?**

No. It lives under `$DSH_HOME`, never inside your repository, and is never committed.

**How is this related to the official repository?**

It is not. This is an independent open-source plugin in the community ecosystem, built on the officially documented plugin interfaces.

---

## 9. Development

```sh
pnpm install
pnpm test           # 92/92: unit + lock primitives + storage integration + project memory + consolidation + harness integration + full AgentLoop test
pnpm run build      # tsc compiles to lib/
```

- Loop tests use scripted model responses to verify integration; they do not measure real-model memory quality.
- Tests are green on the current dependency lines, 92 each on `0.1.7-alpha.1` and `0.2.0-rc.2`
- The storage layer deliberately uses `node:fs` directly, because it is plugin-internal trusted state like settings or session persistence, not the sandboxed model-facing `ctx.fs` seam
- Code layout:

| File | Responsibility |
|---|---|
| `src/index.ts` | The plugin itself: config, wiring, turn-boundary trigger |
| `src/profile.ts` | Pure document model of the personal profile: parse, serialize, merge, evict, render, freshness annotation |
| `src/store.ts` | Atomic-write store for the personal profile, including budget eviction and timestamp-preserving rewrites |
| `src/lock.ts` | Read-modify-write protection: in-process serialization plus a cross-process lock file |
| `src/workspace.ts` | Project memory layer: topic files, index rebuild, keyword search |
| `src/consolidate.ts` | Background tidying: deterministic rules, model-proposal parsing, apply and audit log |
| `src/tools.ts` | The five model-facing tools |
| `src/prompt.ts` | Prompt injection: profile and project memory index |

---

## 10. Roadmap

The v2 plan follows a 2026-10 survey of memory architectures, including OpenAI's three evaluation axes, Claude Code's layered auto-memory, Letta's sleep-time compute and filesystem benchmarks, Mem0, and Zep's bi-temporal invalidation.

- ✅ **Temporal semantics**, shipped in 0.2.0: soft invalidation, aging annotations and `includeStale` auditing, so memories stay correct over time
- ✅ **Layered memory**, shipped in 0.2.0: personal profile plus project memory, index injection with lazy bodies; project identity is the sha256 of the session directory realpath
- ✅ **File-first search**, shipped in 0.2.0: keyword scoring with one-line snippets. Embedding recall waits until the entry count is far larger
- ✅ **Background tidying**, shipped in 0.2.0: asynchronous at turn boundaries plus a manual tool, deterministic rules as the base, optional model assistance, always with an audit log
- **Review-style consolidation**: a subagent reads the profile and a session summary and emits a structured diff, for semantic convergence, plus once-per-session, short-conversation skip and a soft budget cap
- **More triggers**: session idle, compaction and scheduled runs
- **Per-entry creation time**: record the first write time separately for every memory
- Per-user profiles, keyed by session identity
- Progress on all of the above is tracked in [issue #1][issue1]

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
[readme-zh]: README.md
[topic]: https://github.com/topics/dsh-plugin
[harness]: https://github.com/deepseek-ai/deepseek-harness
[issue1]: https://github.com/IAMLieutenant/dsh-tool-user-memory/issues/1

[s1]: #1-the-problem-it-solves
[s2]: #2-capabilities
[s3]: #3-install
[s4]: #4-verify-the-install
[s5]: #5-usage-guide
[s6]: #6-where-the-memory-lives
[s7]: #7-tool-reference
[s8]: #8-faq
[s9]: #9-development
[s10]: #10-roadmap
