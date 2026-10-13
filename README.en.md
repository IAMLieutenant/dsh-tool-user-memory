# dsh-tool-user-memory

[![npm version][badge-npm]][npm-url] [![CI][badge-ci]][ci-url] [![GitHub release][badge-release]][release-url] [![MIT License][badge-license]](LICENSE)

**Persistent preferences and project context for [DeepSeek Harness][harness], across sessions and computers.**

Memory lives in local Markdown files you can inspect, edit, and back up. This is an independently maintained community plugin.

[中文](README.md) · [npm][npm-url] · [Changelog](CHANGELOG.md) · [Release v0.4.0][release-url]

## Highlights

| Feature | What it provides |
|---|---|
| Cross-session memory | Persistent preferences, injected into system prompts within a byte budget |
| Manager inside DSH | Browse, search, create, edit, and delete without opening another page |
| Pinned preferences | Display and prompt priority, with protection against capacity eviction and truncation |
| Project isolation | Separate conventions by directory, Git root, or explicit project path |
| Migration | JSON export/import, project mapping, conflict preview, backups, and undo |
| Change protection | Pre-write snapshots and complete archives before capacity eviction or truncation |
| Lifecycle controls | Keyword search, invalidation, age annotations, and optional consolidation |
| Diagnostics | Inspect storage paths, project identity, and counts |

### Follows the DSH theme

The compact dialog contains **Overview, Memory, and Migration**. It uses DSH color and font variables.

| Dark | Light |
|---|---|
| ![Memory overview in DSH dark mode][image-dark] | ![Memory overview in DSH light mode][image-light] |

Screenshots show a local DSH web instance with demonstration data.

## Quick start

With DeepSeek Harness already installed:

```sh
dsh plugin --profile web add dsh-tool-user-memory@0.4.0
```

Replace `web` with your profile. Restart DSH after installing or upgrading; restart `dsh web` for web mode. Existing memory files remain readable without manual migration.

1. Open **Plugins → dsh-tool-user-memory → Configure → Manage memory**.
2. Create a user memory, such as “Use concise English answers and start with the conclusion.”
3. Open a new session and call `memory_get` to verify the saved preference.

You can also ask the agent to save a preference using `memory_update`. Tools and prompt injection are enabled by default; automatic consolidation is off. Successful storage does not guarantee that a model always follows the preference.

## Managing and pinning memory

- **Overview:** user entries, project topics, and profile capacity.
- **Memory:** user/project selection, keyword filtering, full text, creation, and editing.
- **Editor:** save, cancel, or delete after confirmation.
- **Migration:** export, choose a file, map projects, preview, and import.

### Pin an important preference

Edit a **user memory**, select **置顶记忆 (Pin memory)**, and save. Clear the checkbox and save to unpin. Project topics do not currently support pinning.

![Pin checkbox in the user memory editor][image-pin]

| Behavior | Rule |
|---|---|
| Display priority | User lists and `memory_get` return pinned entries first |
| Prompt priority | Within a group, pinned entries precede others; then newest content first |
| Capacity protection | Pinned content is never automatically evicted or truncated; if the protected set exceeds `maxBytes`, the write fails and existing content remains unchanged |
| Content age | Changing only the pin preserves the entry timestamp and invalidation state |
| Portability | JSON exports, imports, backup recovery, and history recovery retain pin state |

Prompt budgets still apply: pinning does not guarantee full inclusion in context. Invalidated memories are excluded even if pinned. Explicit edits, deletion, and consolidation rules can still change pinned entries.

Older clients, including 0.3.0, can read the content but do not enforce pin protection and may drop pin metadata when saving or exporting. Keep a new export and complete storage backup before downgrading.

## Migration between computers

### Inside DSH

1. On the old computer, export JSON from **Manage memory → Migration**.
2. Transfer the file using your preferred method.
3. On the new computer, select it and map old projects to existing local directories.
4. Review additions, conflicts, and unmapped projects, then confirm.
5. Review the result; use the retained import backup to undo when needed.

![Import result with counts and reasons][image-migration]

The UI keeps local entries on conflicts. Identical content is not duplicated; unmapped projects are listed and skipped. Changes after preview require a new preview. Files are backed up before import. Undo refuses to overwrite files modified after import.

### Export without upgrading the old DSH plugin

Use the new standalone command. Choose the syntax for your terminal.

**Windows Command Prompt (CMD):**

```cmd
npx --yes --package=dsh-tool-user-memory@0.4.0 dsh-memory export --file "%USERPROFILE%\dsh-memory.json"
```

**PowerShell:**

```powershell
npx --yes --package=dsh-tool-user-memory@0.4.0 dsh-memory export --file "$env:USERPROFILE\dsh-memory.json"
```

**macOS/Linux:**

```sh
npx --yes --package=dsh-tool-user-memory@0.4.0 dsh-memory export --file "$HOME/dsh-memory.json"
```

Do not mix CMD's `%USERPROFILE%` and PowerShell's `$env:USERPROFILE`. Export refuses to overwrite an existing file. DSH may stay open; pause memory edits during export for a more consistent snapshot. The first `npx` call may download dependencies. Use `--offline` only with a complete cache.

### Preview, apply, and undo with the CLI

PowerShell example; obtain the project ID from export or preview. The target directory must exist.

```powershell
npx --yes --package=dsh-tool-user-memory@0.4.0 dsh-memory import --file "$env:USERPROFILE\dsh-memory.json" --map "PROJECT_ID=C:\projects\demo"
# After reviewing, repeat the options and supply the returned token:
npx --yes --package=dsh-tool-user-memory@0.4.0 dsh-memory import --file "$env:USERPROFILE\dsh-memory.json" --map "PROJECT_ID=C:\projects\demo" --apply --token "PREVIEW_TOKEN"
npx --yes --package=dsh-tool-user-memory@0.4.0 dsh-memory rollback --file "BACKUP_PATH"
```

| Option | Purpose |
|---|---|
| `--global-only` | Export only user memory |
| `--skip-profile` | Import only mapped projects |
| `--map "ID=directory"` | Project mapping; repeat for multiple projects |
| `--policy keep-local` | Keep local conflicting content; default |
| `--policy use-imported` | Explicitly replace conflicting content |
| `--profile <file>` | Custom profile path |
| `--workspace-base <directory>` | Custom project memory root |
| `--max-bytes <number>` | Custom profile capacity |
| `--workspace-mode git-root` | Git-root project identity; default is `directory` |

CLI defaults to `$DSH_HOME/user-memory`, or `~/.dsh/user-memory` when unset. It **does not read DSH plugin configuration**. Pass custom storage, capacity, and project-mode options explicitly. DSH tools and the embedded manager use the running plugin configuration.

Import rejects capacity overflow rather than evicting entries. Exports and individual import backups are limited to 16 MiB. Recoverable write failures roll back automatically; forced termination may leave partial writes, with recovery records in `migration-backups/*.json`. Version 1 exports from 0.3.0 remain supported; absent pin metadata means unpinned.

Exports read memory rather than account settings or credentials. They do not upload data automatically.

## Configuration

Defaults work without customization. Override the row with id `tool-user-memory` in your profile's `cordis.patch.yml`. Paths below are effective defaults; an empty path selects the default.

| Setting | Default | Meaning |
|---|---|---|
| `path` | `$DSH_HOME/user-memory/user.md` | User profile file |
| `maxBytes` | `8192` | Integer profile limit, 1–16 MiB; unpinned invalidated entries are evicted first, then oldest entries; full content is archived |
| `promptMaxBytes` | `2048` | Profile content budget, pinned first; `0` includes all valid entries |
| `includeInPrompt` | `true` | Inject profile and project index; tools remain available when disabled |
| `staleAfterDays` | `0` | Age annotation only; `0` disables it |
| `workspacePromptMaxBytes` | `512` | Project index budget; `0` disables index injection |
| `workspaceBase` | `$DSH_HOME/user-memory/workspace` | Project memory storage root |
| `workspaceMode` | `directory` | Session directory, or `git-root` for the nearest repository root; falls back to directory outside repositories |
| `projectPath` | `''` | Explicit existing project directory, overriding session directory and project mode |
| `autoConsolidate` | `false` | Background consolidation at turn boundaries |
| `consolidateMinIntervalMs` | `600000` | Minimum interval in milliseconds; `0` removes the interval limit |
| `autoInvalidateAfterDays` | `0` | Invalidate old entries during consolidation; `0` disables it |
| `consolidateProvider` | `''` | Optional consolidation provider |
| `consolidateModel` | `''` | Optional consolidation model |
| `consolidateMaxTokens` | `1024` | Output token limit for one consolidation call |
| `consolidationLogPath` | `$DSH_HOME/user-memory/consolidation-log.md` | Consolidation audit log |

Bytes are not tokens; prompt framing is additional. A topic body is limited to 16 KiB, including appended content; overflow fails without changing it. `maxBytes` does not limit total project memory, history, archives, or logs. Omitted content remains readable through tools.

Directory mode may create separate memory for subdirectories. Git-root mode shares memory across repository subdirectories. Changing modes or `projectPath` does not merge old memory; use migration to map it.

## Agent tools

Eight tools are registered. Project tools use the session directory or explicit project configuration.

| Tool | Parameters | Purpose |
|---|---|---|
| `memory_get` | `query?`, `limit?` (50 by default, max 100), `includeStale?` | Read the user profile, pinned first; excludes invalidated entries by default |
| `memory_update` | `key`, `value`, `mode?`, `reason?`, `scope?` | Set, append, invalidate, or remove; defaults to `global` and `set` |
| `memory_search` | `query?`, `limit?` (10 by default, max 20), `includeStale?` | Search profile/current project, including Chinese substrings; scores and snippets |
| `memory_topic` | `topic` | Full project topic with invalidation metadata |
| `memory_consolidate` | `mode?` (default `plan`), `useModel?` | Preview or apply consolidation |
| `memory_export` | `destination`, `scope?` (default `all`) | Local JSON export; `global` exports only the profile |
| `memory_import` | `source`, `includeProfile?`, `projectMap?`, `policy?`, `dryRun?`, `previewToken?` | Defaults to preview and keep-local; application requires a valid token |
| `memory_status` | None | Actual storage paths, identity, and counts; no memory text or model call |

`memory_update`: `set` replaces and `append` appends, both restoring validity. `invalidate` preserves content with a reason; `remove` deletes active content. The latter two accept an empty `value`. Normal updates retain pin state; pinning is controlled in the UI. Results report capacity eviction, truncation, and archive information.

`includeStale=true` includes **invalidated records**. Age annotations do not invalidate entries. Only project indexes enter prompts automatically; topic bodies are read on demand. Topic names are at most 64 characters and reject separators, reserved filename characters, `MEMORY`, and Windows device names.

Keyword scoring: title match +3, each body match +1 up to 5, all-keyword match +4. Semantic search is not implemented.

### Optional consolidation

Deterministic rules retain the newest duplicate and invalidate others, append absolute recording dates for relative-time entries, and report or invalidate aged entries according to configuration. Optional model proposals validate `add`, `merge`, `rewrite`, `invalidate`, `topic-add`, and `topic-invalidate`; unavailable or invalid model responses fall back to deterministic rules.

`plan` reports changes; `apply` writes and logs them. Content and pin state are checked before application; changed entries are skipped. Model-assisted consolidation sends memory to the configured provider and incurs model costs.

## Storage, history, and backups

```text
$DSH_HOME/user-memory/
├── user.md                     # User profile
├── .history/<file-hash>/       # Last 20 pre-write snapshots per file
├── .archive/<file-hash>/       # Full entries before capacity removal/truncation
├── migration-backups/          # Import backups and recovery records
├── consolidation-log.md        # Consolidation audit
└── workspace/<project-hash>/
    ├── MEMORY.md               # Active topic index
    ├── <topic>.md              # Topic body and metadata
    └── .history/<file-hash>/   # Topic snapshots
```

Windows defaults to `C:\Users\<username>\.dsh\user-memory\user.md`. Custom paths take precedence; default storage is outside project repositories. Project IDs use the first 16 hexadecimal characters of SHA-256 over the effective directory's `realpath`, lowercased on Windows and case-sensitive on Linux. Topic writes rebuild the index.

| State/action | Effect |
|---|---|
| Active | Included in prompts and default search |
| Stale | Age annotation; still active |
| Invalidated | Text and reason retained; excluded from prompts/default search |
| Deleted | Removed from active memory and later prompts; snapshots remain |
| Capacity eviction/truncation | Only unpinned entries; full text archived first |

History and archives are stored in the background. The compact UI has no history browser or archive recovery controls; recovery exists in the storage/manager backend. At 1000 archive files or 64 MiB, further writes are rejected rather than pruning archives. Manual Markdown edits do not create snapshots; preserve headings, timestamps, and pin metadata. Invalid metadata may reject reads.

**JSON includes** profile entries, topics, timestamps, invalidation, and pin state. It **excludes** snapshots, archives, logs, and account settings. Copy actual storage directories separately for complete backup. Exports and recovery records contain memory text.

Deletion is not permanent erasure; complete removal also requires handling relevant snapshots, archives, migration backups, logs, and saved exports.

## Diagnostics and troubleshooting

Use `memory_status` in DSH to inspect the actual plugin configuration. Standalone commands:

```sh
npx --yes --package=dsh-tool-user-memory@0.4.0 dsh-memory doctor --cwd "PROJECT_DIRECTORY"
npx --yes --package=dsh-tool-user-memory@0.4.0 dsh-memory manage
```

`doctor` checks storage and project identity; the manager backend supports current prompt previews. Standalone `manage` prints a local URL, listens only on loopback, and stops with Ctrl+C. DSH web uses the embedded dialog. Pass custom options when using the CLI.

| Problem | Check |
|---|---|
| New session ignores memory | Profile, paths, injection switch, invalidation, and budget; verify with `memory_get` |
| Project memory missing | Session directory, project mode, explicit path, and import mapping |
| Manager entry missing | Version 0.4.0, restarted DSH web service, enabled plugin client |
| Pinned capacity failure | Shorten/unpin entries or increase `maxBytes`; original profile is preserved |
| Concurrent-change error | Refresh or repeat the import preview |
| Export reports `ENOENT` | Paths, permissions, and correct terminal-variable syntax |
| First `npx` call slow | Registry/network downloads; offline only with a complete cache |

Prompt framing labels memory as reference data rather than instructions, without guaranteeing model compliance. There is no comprehensive sensitive-data filter; do not store credentials. Real-model memory extraction, usage, and long-term accuracy still require practical evaluation.

## Development and verification

```sh
git clone https://github.com/IAMLieutenant/dsh-tool-user-memory.git
cd dsh-tool-user-memory
pnpm install --frozen-lockfile
pnpm test
pnpm run build
pnpm pack
dsh plugin --profile web add ./dsh-tool-user-memory-0.4.0.tgz
```

| DSH dependency set | Tests | Build |
|---|---|---|
| `0.1.7-alpha.1` | 127/127 passed | Passed |
| `0.2.0-rc.2` | 127/127 passed | Passed |

Coverage includes parsing, pin protection, budgets, locks, storage, project identity, consolidation, migration recovery, manager operations, Harness, and AgentLoop integration. Loop tests use scripted model responses. A real DSH 0.1.7-alpha.1 web instance verified theme changes, opening/closing, cancel, viewing/saving, pin/unpin, and capacity rejection. Dependency tests do not establish runtime UI compatibility with every client.

| Files | Responsibility |
|---|---|
| `src/index.ts` | Configuration, services, registration, automatic consolidation |
| `src/profile.ts`, `src/store.ts` | Profile format, pins, capacity, rendering, persistence |
| `src/lock.ts`, `src/history.ts` | Concurrency, snapshots, archives |
| `src/workspace.ts`, `src/prompt.ts` | Projects, indexes, search, injection |
| `src/consolidate.ts`, `src/tools.ts` | Consolidation and tools |
| `src/migration.ts`, `src/migration-tools.ts` | Export, preview, backup, rollback |
| `src/manager.ts`, `src/manager-web.ts` | Manager operations and local HTTP |
| `src/manager-ui.ts`, `src/client.js` | UI, DSH entry, theme synchronization |
| `src/migrate-cli.ts`, `scripts/build-assets.mjs` | CLI and client build |

## Evolution

| Version | Main changes |
|---|---|
| `0.1.x` | User profile and cross-session injection |
| `0.2.x` | Projects, search, invalidation, age annotations, consolidation, concurrency fixes |
| `0.3.0` | JSON migration, mapping, previews, conflict policies, backup/rollback |
| `0.4.0` | Embedded manager, pins, themes, history/archives, migration wizard, project identity, diagnostics |

Candidate directions include provenance, user-confirmed memory suggestions, creation timestamps, project priorities, and reproducible evaluations. Semantic search and encrypted synchronization are not implemented. See [ROADMAP](ROADMAP.md); feedback is welcome in [Issues][issues-url].

## License

[MIT](LICENSE)

[badge-npm]: https://img.shields.io/npm/v/dsh-tool-user-memory
[badge-ci]: https://github.com/IAMLieutenant/dsh-tool-user-memory/actions/workflows/ci.yml/badge.svg
[badge-release]: https://img.shields.io/github/v/release/IAMLieutenant/dsh-tool-user-memory
[badge-license]: https://img.shields.io/badge/license-MIT-blue
[ci-url]: https://github.com/IAMLieutenant/dsh-tool-user-memory/actions/workflows/ci.yml
[npm-url]: https://www.npmjs.com/package/dsh-tool-user-memory
[issues-url]: https://github.com/IAMLieutenant/dsh-tool-user-memory/issues
[release-url]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.4.0
[harness]: https://github.com/deepseek-ai/deepseek-harness
[image-dark]: https://raw.githubusercontent.com/IAMLieutenant/dsh-tool-user-memory/v0.4.0/docs/images/manager-dark.png
[image-light]: https://raw.githubusercontent.com/IAMLieutenant/dsh-tool-user-memory/v0.4.0/docs/images/manager-light.png
[image-pin]: https://raw.githubusercontent.com/IAMLieutenant/dsh-tool-user-memory/v0.4.0/docs/images/pin-setting.png
[image-migration]: https://raw.githubusercontent.com/IAMLieutenant/dsh-tool-user-memory/v0.4.0/docs/images/migration-result.png
