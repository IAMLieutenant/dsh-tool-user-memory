# dsh-tool-user-memory

[![npm version][badge-npm]][npm-url] [![GitHub release][badge-release]][release-url] [![MIT License][badge-license]](LICENSE)

**Give [DeepSeek Harness][harness] persistent user preferences and project context across sessions, with migration between computers.**

Reduce repeated explanations of your language preferences, communication style, and project conventions when starting a new session. Memory is stored in local Markdown files that you can inspect, edit, and back up. This project is developed and maintained independently by the community.

[中文][readme-zh] · [npm][npm-url] · [Changelog][changelog] · [Release v0.3.0][release-url]

## Highlights

| What you need | What the plugin provides |
|---|---|
| Preferences that survive new sessions | A persistent global profile, with valid entries injected into system prompts within a byte budget |
| Separate conventions for each project | Project memory selected by the session's working directory |
| Memory that moves with you | JSON export and import, project directory mapping, conflict previews, and import backups |
| Visibility into what is remembered | Local Markdown files you can inspect, edit, and back up, without deploying an additional memory service |
| A way to retire outdated information | Soft invalidation retains text and reasons while excluding entries from prompt injection and default search |
| Access to growing memory collections | Keyword search, topic reading, and optional consolidation |

## What to remember

- **Personal preferences:** response language, how much detail you want, and your preferred communication style.
- **Project context:** test commands, directory conventions, important decisions, and operational notes worth retaining.
- **Context to take with you:** export on your old computer, then import with project directories mapped to your new computer.

## Quick start

With DeepSeek Harness installed, run:

```sh
dsh plugin --profile web add dsh-tool-user-memory@0.3.0
```

Replace `web` with the profile you use. Restart your DSH session after installation; in web mode, restart `dsh web`.

Memory tools and prompt injection are enabled by default. Automatic consolidation is disabled by default, and model-assisted consolidation requires a configured provider and model. Existing memory files require no manual migration when upgrading to 0.3.0.

### Try it after installation

1. Ask DSH: **"Use memory_update to save 'Answer in English and start with the conclusion before explaining details' in my global user profile."** Confirm that the tool reports a successful write.
2. Start a new session using the same storage configuration. Ask: **"Use memory_get to read my global user profile and tell me the response preferences saved there."** Verify that the saved memory can be read across sessions.
3. To move it to another computer, follow the [export and import guide](#move-memory-to-another-computer). Exporting does not require upgrading the plugin on the old computer.

Whether the model follows a preference accurately still depends on its behavior. These steps verify that the memory is saved and accessible in a new session.

If this plugin is useful to you, **⭐ Star** the repository to find it again. Feedback, bug reports, and feature suggestions are welcome in [Issues][issues-url].

## Contents

- [1. Features and operation](#1-features-and-operation)
- [2. Installation and verification](#2-installation-and-verification)
- [3. Configuration](#3-configuration)
- [4. Usage examples](#4-usage-examples)
- [5. Storage and lifecycle](#5-storage-and-lifecycle)
- [6. Tool reference](#6-tool-reference)
- [7. Limitations and troubleshooting](#7-limitations-and-troubleshooting)
- [8. Development and validation](#8-development-and-validation)
- [9. Version history and roadmap](#9-version-history-and-roadmap)

## 1. Features and operation

### Memory scopes

| Scope | Suitable content | Access |
|---|---|---|
| Global user profile | Language preferences, communication style, personal background, long-term goals | Injected into the system prompt within the configured budget; readable through `memory_get` |
| Project memory | Project background, conventions, and operational notes | The session directory selects the index; `memory_search` retrieves matches and `memory_topic` reads full topics |

The global user profile is shared by profiles and workspaces using the same storage path. Project memory is selected by the session's working directory; a subdirectory may have a different memory location from its parent.

### Features

| Feature | Description |
|---|---|
| Persistent storage | Markdown entries that can be inspected and edited directly |
| Prompt injection | Reads the valid user profile and current project index during prompt assembly, subject to byte budgets |
| Keyword search | Searches the profile and current project memory, returning scores and snippets |
| Time tracking | Records update timestamps and supports aging annotations and soft invalidation |
| Consolidation | Merges duplicates, adds recorded dates to entries with relative time expressions, and handles outdated content according to configuration |
| Audit records | Records consolidation results, reasons for skipped operations, and trigger sources |

### Processing flow

```text
The user requests that information be remembered
  → the agent calls memory_update
  → the plugin writes the global profile or a current project topic
  → subsequent prompt assembly reads the valid profile and project index
  → the agent uses memory tools to read additional content as needed
```

Writes use atomic replacement, with serialization within a process and a lock across processes to protect read-modify-write operations. Consolidation checks that entries still match the state used to generate the plan. Changed entries are skipped to prevent an older plan from overwriting newer content.

## 2. Installation and verification

### Requirements

- A working [DeepSeek Harness][harness] installation with the `dsh` CLI.
- Version 0.3.0 has passed builds and 108 tests on each of the DSH dependency versions `0.1.7-alpha.1` and `0.2.0-rc.2`.
- `dsh plugin` installs the npm package and adds the plugin to the profile's bundle configuration using its `dsh.bundle.patch` declaration.

### Installation and upgrades

The quick-start command applies to both installation and upgrades. Other profiles use the same syntax, for example:

```sh
dsh plugin --profile headless add dsh-tool-user-memory@0.3.0
```

### Installation from source

```sh
git clone https://github.com/IAMLieutenant/dsh-tool-user-memory.git
cd dsh-tool-user-memory
pnpm install --frozen-lockfile
pnpm run build
pnpm pack
dsh plugin --profile web add ./dsh-tool-user-memory-0.3.0.tgz
```

### Verification

1. Check the profile's `package.json` and confirm that `dsh.profile.bundles` includes `dsh-tool-user-memory`.
2. Restart the session and ask the agent which memory tools are available. Version 0.3.0 provides the seven tools documented below.
3. Request that a preference be saved, confirm a successful tool result, and check that the profile file contains the entry.

Example profile configuration:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-tool-user-memory"
      ]
    }
  }
}
```

The default profile path is `$DSH_HOME/user-memory/user.md`. On Windows, the default location is `C:\Users\<username>\.dsh\user-memory\user.md`; a custom `DSH_HOME` or `path` changes this location.

## 3. Configuration

The plugin can run with its default configuration. To change settings, override the entry with id `tool-user-memory` in the profile's `cordis.patch.yml`.

Storage paths below are the effective defaults when no custom path is configured.

| Key | Default | Description |
|---|---|---|
| `path` | `$DSH_HOME/user-memory/user.md` | Global user profile path |
| `maxBytes` | `8192` | Profile file byte limit; invalidated entries are evicted first, followed by entries from oldest to newest |
| `promptMaxBytes` | `2048` | Injected profile content budget; newer entries take priority, and oversized entries are marked as truncated; `0` injects the full valid profile |
| `includeInPrompt` | `true` | Enables memory prompt injection; disabling it stops both profile and project index injection |
| `staleAfterDays` | `0` | Entries not updated for this many days receive a `[stale: last updated Nd ago]` annotation; annotation only, `0` disables it |
| `workspacePromptMaxBytes` | `512` | Injected project index content budget; `0` disables project index injection |
| `workspaceBase` | `$DSH_HOME/user-memory/workspace` | Project memory root directory |
| `autoConsolidate` | `false` | Enables asynchronous automatic consolidation at turn boundaries |
| `consolidateMinIntervalMs` | `600000` | Minimum interval between automatic runs, in milliseconds; `0` removes the interval limit |
| `autoInvalidateAfterDays` | `0` | Consolidation soft-invalidates entries not updated for this many days; `0` disables it |
| `consolidateProvider` | `''` | Provider for model-assisted consolidation; empty uses deterministic rules |
| `consolidateModel` | `''` | Model id for model-assisted consolidation |
| `consolidateMaxTokens` | `1024` | Output token limit for one consolidation model call |
| `consolidationLogPath` | `$DSH_HOME/user-memory/consolidation-log.md` | Consolidation audit log path |

### Capacity and budgets

- `promptMaxBytes` and `workspacePromptMaxBytes` limit injected memory content. Explanatory prompt text is additional; byte counts are not token counts.
- Profile content omitted from the prompt remains accessible through `memory_get`. Project topic bodies are read on demand through `memory_topic`.
- A project topic body is limited to 16 KiB, including appended content. An append that exceeds this limit is rejected and the existing content is preserved.
- `maxBytes` limits the global profile file. It does not cap the combined size of all project memory and logs.
- Topic names cannot be `MEMORY`, Windows device names, or contain characters reserved in filenames. Names are limited to 64 characters.

## 4. Usage examples

These examples show how to express an operation to the agent. Actual tool calls depend on the model; inspect tool results and local files to confirm writes or changes.

### Save and query preferences

> Remember: I prefer concise answers in Chinese.

The expected call is `memory_update`, which writes to the global profile by default. Suitable content includes stable preferences, personal background, and long-term goals. One-off tasks, credentials, passwords, and tokens should not be stored as memory.

> Show my saved language and communication-style preferences.

Use `memory_get` to query the user profile, or `memory_search` to search the profile and current project memory.

### Update, invalidate, and delete

| Intent | Example | Operation |
|---|---|---|
| Update content | Change my language preference to English | `memory_update`, `mode=set` |
| Retain history and stop using an entry | Invalidate the old project background because the project has migrated | `memory_update`, `mode=invalidate`, with a `reason` |
| Remove a record | Delete my saved language preference | `memory_update`, `mode=remove` |

Soft invalidation retains the record and excludes it from prompts and default search results. Deletion removes the record.

### Save project conventions

Open a session in the target project directory, then request:

> Save these conventions in the current project memory: use pnpm for dependencies and run pnpm test before committing.

The corresponding call is `memory_update` with `scope=workspace`. Sessions opened in other working directories read memory associated with those directories.

### Consolidate memory

> Generate a memory consolidation plan first and list the proposed operations.

Use `memory_consolidate` with `mode=plan` to inspect a plan. Use `mode=apply` to execute operations and record the results in the audit log. Model-assisted consolidation requires a configured provider and model and `useModel=true`.

### Verify access across sessions

1. Save a language preference and confirm that the write succeeded.
2. In a new session with the same plugin configuration enabled, ask for the saved language preference.
3. Check that the answer matches the record; use `memory_get` for verification if needed.

Under the default configuration, the valid profile is injected into the system prompt within its budget. The model can read this content without first calling a tool, but answer accuracy still depends on model behavior.

### Move memory to another computer

Version 0.3.0 adds `memory_export`, `memory_import`, and the standalone `dsh-memory` command. Exports include the global profile, every stored project, timestamps, and invalidation state. Only memory files are read; consolidation logs, plugin configuration, caches, and account credential stores are excluded. Imports rebuild the project index for the mapped local directory. Same-key conflicts retain local entries by default; unmapped projects are listed and skipped.

The old computer does not need a plugin upgrade. Choose the command for your terminal, then transfer the resulting JSON file using your preferred method.

**Windows Command Prompt (CMD, typically showing `C:\...>`):**

```cmd
npx --yes --package=dsh-tool-user-memory@0.3.0 dsh-memory export --file "%USERPROFILE%\dsh-memory.json"
```

**PowerShell (typically showing `PS C:\...>`):**

```powershell
npx --yes --package=dsh-tool-user-memory@0.3.0 dsh-memory export --file "$env:USERPROFILE\dsh-memory.json"
```

CMD uses `%USERPROFILE%`; PowerShell uses `$env:USERPROFILE`. Do not mix them: a variable may be treated as a literal directory name and cause `ENOENT`.

An existing destination is never overwritten. DSH can remain open: each memory document is read under its lock, although different projects may be snapshotted at different times. Pause memory updates for a more consistent export. Stored memory remains exportable after its original project directory has been deleted.

The first `npx` run may download the package and its dependencies, so a delay may come from network requests. If the command has already run successfully and its dependencies are cached, add `--offline` after `npx` to use the cache. CMD example:

```cmd
npx --offline --yes --package=dsh-tool-user-memory@0.3.0 dsh-memory export --file "%USERPROFILE%\dsh-memory-offline.json"
```

Incomplete caches cause the offline command to fail; run the online command to finish downloading. Export bundles are limited to 16 MiB, and their actual size depends on the stored memory.

On the new computer, upgrade the plugin and restart the session. Ask the agent to preview the transferred file with `memory_import`, retain local conflicts, list unmapped projects, and wait before applying. Supply an explicit local directory for every project you want to import. Applying requires the confirmed preview's `previewToken`; changes to the source, options, or destination require a new preview.

Command-line import is also supported. Use the project ID returned by export or preview, and an existing target directory.

**PowerShell:**

```powershell
npx --yes --package=dsh-tool-user-memory@0.3.0 dsh-memory import --file "$env:USERPROFILE\dsh-memory.json" --map "exportedProjectID=C:\projects\demo"
# After confirming, use the same options with the token returned by preview:
npx --yes --package=dsh-tool-user-memory@0.3.0 dsh-memory import --file "$env:USERPROFILE\dsh-memory.json" --map "exportedProjectID=C:\projects\demo" --apply --token "returnedPreviewToken"
```

**CMD:** Run the first line to inspect the preview, then replace the token in the second line and run it to apply.

```cmd
npx --yes --package=dsh-tool-user-memory@0.3.0 dsh-memory import --file "%USERPROFILE%\dsh-memory.json" --map "exportedProjectID=C:\projects\demo"
npx --yes --package=dsh-tool-user-memory@0.3.0 dsh-memory import --file "%USERPROFILE%\dsh-memory.json" --map "exportedProjectID=C:\projects\demo" --apply --token "returnedPreviewToken"
```

Use repeated `--map` options for multiple projects. Target directories must exist. `--policy use-imported` replaces same-key conflicts; `--skip-profile` imports mapped projects only. Capacity overflow aborts the import without eviction. Bundles and individual import backups are limited to 16 MiB.

The CLI reads `$DSH_HOME/user-memory`, or `~/.dsh/user-memory` when unset. It does not read plugin configuration. Custom storage and capacity require matching `--profile`, `--workspace-base`, and `--max-bytes` options. Tools use the running plugin's configuration.

All changed files are backed up before the first memory write. Handled write failures trigger rollback. Forced process termination can leave a partial import; recovery journals remain in the profile directory's `migration-backups/*.json`. Restore using the returned `backupPath` and the same storage options:

```powershell
npx --yes --package=dsh-tool-user-memory@0.3.0 dsh-memory rollback --file "returnedBackupPath"
```

Rollback refuses to overwrite files edited after import. Exports and backups contain full memory text and should be treated as personal data. Export never uploads the file.

## 5. Storage and lifecycle

### Default file layout

```text
$DSH_HOME/user-memory/
├── user.md                     # global user profile
├── consolidation-log.md        # consolidation audit log
└── workspace/
    └── <hash16>/               # storage for the session's working directory
        ├── MEMORY.md           # index of valid topics
        └── <topic>.md          # topic body and metadata
```

The project directory identifier is the first 16 hexadecimal characters of SHA-256 over the lowercased `realpath` of the session's working directory. The index contains topic names and one-line summaries and is rebuilt after topic writes.

Default storage is under `$DSH_HOME`, outside the project repository. Custom `path` or `workspaceBase` settings determine the actual storage locations.

### Entry states

| State or operation | Behavior |
|---|---|
| Valid | Eligible for prompt injection and default search |
| Aging annotation | Adds a hint at the `staleAfterDays` threshold; the entry remains valid |
| Soft invalidation | Retains content, invalidation time, and reason; excluded from injection and hidden from default search |
| Reactivation | `set` or `append` on the same key restores validity |
| Eviction | Removes entries when the global profile exceeds its capacity, prioritizing invalidated and older entries |
| Deletion | `remove` deletes the corresponding record |

### Manual editing

The profile is a Markdown file and can be edited directly while preserving its headings and metadata format. Subsequent reads and prompt assembly use the file content.

```markdown
# User Memory

## language
<!-- ts: 2026-10-10T01:15:38.092Z -->
Concise answers in Chinese

## old-project
<!-- ts: 2026-08-14T00:00:00.000Z -->
<!-- invalid: 2026-10-10T02:00:00.000Z | project migrated -->
Notes about the old project
```

## 6. Tool reference

### `memory_get`

Reads the global user profile.

| Argument | Required | Description |
|---|---|---|
| `query` | no | Keyword filter over entry keys or content |
| `limit` | no | Maximum entries returned, default 50, cap 100 |
| `includeStale` | no | `true` includes soft-invalidated entries with invalidation time and reason, default `false` |

Returns `{ ok, total, invalidated, rendered }`. `rendered` is model-facing text and can include aging annotations when `staleAfterDays` is enabled.

### `memory_update`

Writes, appends, soft-invalidates, or deletes memory.

| Argument | Required | Description |
|---|---|---|
| `key` | yes | Memory key, for example `language` or `communication-style` |
| `value` | yes | Content; may be empty for `invalidate` and `remove` |
| `mode` | no | `set` replaces and reactivates; `append` appends and reactivates; `remove` deletes; `invalidate` soft-invalidates |
| `reason` | no | Invalidation reason, stored with the entry |
| `scope` | no | `global` writes the user profile; `workspace` writes current project memory, default `global` |

Returns `{ ok, scope, key, mode, bytes, error? }`. To read invalidated records, set `includeStale=true` in `memory_get` or `memory_search`.

### `memory_search`

Searches the global profile and current project memory by keyword.

| Argument | Required | Description |
|---|---|---|
| `query` | no | Space-separated keywords, with CJK substring matching; empty returns records by update time |
| `limit` | no | Maximum results returned, default 10, cap 20 |
| `includeStale` | no | Includes soft-invalidated entries, default `false` |

Returns `{ ok, total, results }`. Results contain `scope`, `topic`, `score`, `updatedAt`, and `snippet`.

Scoring assigns 3 points for a topic-name match, 1 point per content occurrence up to 5, and 4 additional points for matching all keywords. Profile and project results are ranked together.

### `memory_topic`

Reads the full content of one project memory topic.

| Argument | Required | Description |
|---|---|---|
| `topic` | yes | Topic name from the project index or search results |

Returns `{ ok, topic, updatedAt, invalidated, invalidReason, body }`. Topic bodies are read on demand through the tool and are not directly injected into each turn's prompt.

### `memory_consolidate`

Generates or executes a consolidation plan.

| Argument | Required | Description |
|---|---|---|
| `mode` | no | `plan` returns a plan; `apply` executes operations and records results |
| `useModel` | no | Requests model-assisted consolidation; requires a configured provider and model |

Consolidation includes:

1. **Duplicate merging**: retains the newest record with equivalent normalized content and soft-invalidates duplicates.
2. **Time annotation**: adds an absolute recorded date to entries with relative time expressions, without interpreting or rewriting the original date expression.
3. **Aging**: reports entries at the configured aging threshold and soft-invalidates them according to `autoInvalidateAfterDays`.
4. **Model proposals**: validates and processes `add`, `merge`, `rewrite`, `invalidate`, `topic-add`, and `topic-invalidate`; deterministic rule results are used if the model is unavailable or returns an invalid response.

The audit log records the trigger source, time, applied operations, skipped operations, and reasons. Operations are skipped if entries have changed or merge destinations are no longer valid when execution occurs.

### `memory_export`

Parameters: `destination` (required local JSON path), `scope` (`all` or `global`, default `all`). Returns the path, global entry count, and project IDs, source paths, and topic counts. Refuses existing destinations and live memory files.

### `memory_import`

Parameters: `source` (required), `includeProfile` (default `true`), `projectMap` (`[{id, path}]`), `policy` (default `keep-local`), `dryRun` (default `true`), and `previewToken`. Preview does not write memory. Applying with `dryRun=false` requires the confirmed preview token and returns counts plus `backupPath`. Identical imports do not duplicate entries.

## 7. Limitations and troubleshooting

### Behavior and security boundaries

- The prompt labels memory as reference data and asks the model to avoid executing embedded instructions. This is a prompt constraint and cannot guarantee compliance by every model.
- Tool descriptions instruct the model not to store credentials, but the plugin does not provide an automatic filter covering all sensitive content. Memory files should not contain credentials, passwords, or tokens.
- Memory storage, search, and rule-based consolidation run locally by default. Model-assisted consolidation sends memory content to the configured provider and incurs the associated model usage charges.
- Tests verify storage behavior and tool integration. Memory extraction, use, and long-term accuracy with real models have not been evaluated.

### Saved memory is not used in a new session

Check:

1. Whether the profile's `dsh.profile.bundles` includes the plugin and the session was restarted after installation.
2. Whether the profile was written successfully, the entry is valid, and `includeInPrompt` is enabled.
3. Whether the injection budget omitted or truncated content; use `memory_get` to read the full profile.
4. Whether the session working directory for project memory is unchanged and accessible.

### Working directory unavailable

Project memory depends on the session's working directory. Project writes and topic reads return an error if the directory is missing or inaccessible; personal preferences can still be saved with `scope=global`.

### Clearing data

The global profile, project memory, and audit log are stored separately. Delete the configured `user.md` to clear the profile, the corresponding project storage directory to clear project memory, and the audit log to clear consolidation history. Deleting the profile alone does not remove project memory or logs.

## 8. Development and validation

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm run build
```

Validation results for 0.3.0:

| DSH dependency version | Tests | TypeScript build |
|---|---|---|
| `0.1.7-alpha.1` | 108/108 passed | Passed |
| `0.2.0-rc.2` | 108/108 passed | Passed |

Tests cover document parsing, concurrency locks, storage, project memory, consolidation, Harness integration, and AgentLoop tool calls. Loop tests use scripted model responses.

### Code structure

| File | Responsibility |
|---|---|
| `src/index.ts` | Plugin configuration, service assembly, and turn-boundary triggers |
| `src/profile.ts` | Profile parsing, serialization, merging, eviction, and rendering |
| `src/store.ts` | Atomic writes and concurrency protection for the global profile |
| `src/lock.ts` | Serialization within a process and locking across processes |
| `src/workspace.ts` | Project topic storage, index rebuilding, and search |
| `src/consolidate.ts` | Consolidation plans, model proposal validation, execution, and auditing |
| `src/tools.ts` | Core memory tools and migration tool registration |
| `src/migration.ts` | Snapshot validation, import previews, backups and recovery |
| `src/migrate-cli.ts` | Standalone memory migration command |
| `src/prompt.ts` | Prompt injection for the profile and project index |

The storage layer uses `node:fs` to manage the plugin's persistent state.

## 9. Version history and roadmap

### Released versions

| Version | Main changes |
|---|---|
| `0.1.x` | Global user profile and prompt injection across sessions |
| `0.2.0` | Project memory, keyword search, soft invalidation, time annotations, and consolidation |
| `0.2.1` | Fixes for lost concurrent writes and date rewrites resetting memory age |
| `0.2.2` | Fixes for older consolidation plans overwriting newer content, unintended reactivation, reserved topic-name conflicts, and byte limits |
| `0.2.3` | Concise Chinese package description and revised Chinese and English documentation |
| `0.3.0` | Portable export/import, preview tokens, project mapping, conflict policies, backups, and rollback command |

See the [changelog][changelog] for full release details.

### Planned work

- Semantic consolidation based on session summaries, with frequency and budget limits.
- Additional triggers for session idle time, context compaction, and scheduled consolidation.
- Separate creation timestamps for entries.
- User profiles selected by session identity.

These features are not yet implemented. Progress and acceptance criteria are tracked in [issue #1][issue1].

## License

[MIT](LICENSE)

[badge-npm]: https://img.shields.io/npm/v/dsh-tool-user-memory
[badge-release]: https://img.shields.io/github/v/release/IAMLieutenant/dsh-tool-user-memory
[badge-license]: https://img.shields.io/badge/license-MIT-blue
[npm-url]: https://www.npmjs.com/package/dsh-tool-user-memory
[issues-url]: https://github.com/IAMLieutenant/dsh-tool-user-memory/issues
[release-url]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.3.0
[changelog]: CHANGELOG.md
[readme-zh]: README.md
[harness]: https://github.com/deepseek-ai/deepseek-harness
[issue1]: https://github.com/IAMLieutenant/dsh-tool-user-memory/issues/1
