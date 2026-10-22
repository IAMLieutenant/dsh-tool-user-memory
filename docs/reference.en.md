# Usage and configuration reference

Back to the [README](../README.en.md). **Historical reference for published `0.4.1`.** The local version stores confirmed user preferences only; its [final design](final-design.md) takes precedence. Project tools, pinning, automatic consolidation and old settings below are historical compatibility behavior, not the current normal workflow. See [candidate review](candidate-review.md) for the old review workflow.

Standalone examples use this checkout's built `node lib/migrate-cli.js`. Run `pnpm install --frozen-lockfile` and `pnpm run build` in the repository root first. Use the matching CLI for 0.4.1 data: the older 0.4.0 CLI does not preserve the new provenance fields.

## Managing and pinning memory

- **Pending review:** inspect a suggestion, choose its scope, preview a replacement, and confirm or dismiss it.
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
node lib/migrate-cli.js export --file "%USERPROFILE%\dsh-memory.json"
```

**PowerShell:**

```powershell
node lib/migrate-cli.js export --file "$env:USERPROFILE\dsh-memory.json"
```

**macOS/Linux:**

```sh
node lib/migrate-cli.js export --file "$HOME/dsh-memory.json"
```

Do not mix CMD's `%USERPROFILE%` and PowerShell's `$env:USERPROFILE`. Export refuses to overwrite an existing file. DSH may stay open; pause memory edits during export for a more consistent snapshot. Install dependencies and build first; these standalone commands then use the local build directly.

### Preview, apply, and undo with the CLI

PowerShell example; obtain the project ID from export or preview. The target directory must exist.

```powershell
node lib/migrate-cli.js import --file "$env:USERPROFILE\dsh-memory.json" --map "PROJECT_ID=C:\projects\demo"
# After reviewing, repeat the options and supply the returned token:
node lib/migrate-cli.js import --file "$env:USERPROFILE\dsh-memory.json" --map "PROJECT_ID=C:\projects\demo" --apply --token "PREVIEW_TOKEN"
node lib/migrate-cli.js rollback --file "BACKUP_PATH"
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
| `memory_propose` | `key`, `value`, `scope`, `excerpt?`, `reason?` | Propose a candidate; inactive until reviewed in the manager |
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
├── user.md.candidates.json     # Candidates and review state
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

History and archives are stored in the background. The compact UI has no history browser or archive recovery controls; recovery exists in the storage/manager backend. At 1000 archive files or 64 MiB, further writes are rejected rather than pruning archives. Manual Markdown edits do not create snapshots; preserve headings, timestamps, pin metadata, and provenance. Invalid metadata may reject reads.

**JSON includes** profile entries, topics, timestamps, invalidation, pin state, and new provenance metadata. It **excludes** pending candidates, snapshots, archives, logs, and account settings. Copy actual storage directories separately for complete backup. Exports and recovery records contain memory text.

Deletion is not permanent erasure; complete removal also requires handling relevant snapshots, archives, migration backups, logs, and saved exports.

## Diagnostics and troubleshooting

Use `memory_status` in DSH to inspect the actual plugin configuration. Standalone commands:

```sh
node lib/migrate-cli.js doctor --cwd "PROJECT_DIRECTORY"
node lib/migrate-cli.js manage
```

`doctor` checks storage and project identity; the manager backend supports current prompt previews. Standalone `manage` prints a local URL, listens only on loopback, and stops with Ctrl+C. DSH web uses the embedded dialog. Pass custom options when using the CLI.

| Problem | Check |
|---|---|
| New session ignores memory | Profile, paths, injection switch, invalidation, and budget; verify with `memory_get` |
| Project memory missing | Session directory, project mode, explicit path, and import mapping |
| Manager entry missing | Matching plugin version, restarted DSH web service, enabled plugin client |
| Pinned capacity failure | Shorten/unpin entries or increase `maxBytes`; original profile is preserved |
| Concurrent-change error | Refresh or repeat the import preview |
| Export reports `ENOENT` | Paths, permissions, and correct terminal-variable syntax |
| First dependency installation is slow | Check registry access, finish installation, and build before running the standalone commands |

Prompt framing labels memory as reference data rather than instructions, without guaranteeing model compliance. There is no comprehensive sensitive-data filter; do not store credentials. Real-model memory extraction, usage, and long-term accuracy still require practical evaluation.

[image-pin]: images/pin-setting.png
[image-migration]: images/migration-result.png
