# dsh-tool-user-memory

[![npm](https://img.shields.io/npm/v/dsh-tool-user-memory)](https://www.npmjs.com/package/dsh-tool-user-memory) [![CI](https://github.com/IAMLieutenant/dsh-tool-user-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/IAMLieutenant/dsh-tool-user-memory/actions/workflows/ci.yml) [![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Start a new session without explaining everything again.**

Save preferences, project conventions, and confirmed facts for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): your preferred language, a rollback requirement, or the database a project now uses. The assistant can refer to them in later relevant sessions.

Browse and edit memories inside DSH. They live in local Markdown files and can be exported when you change computers. This is an independently maintained community plugin.

[中文](README.md) · [Installation](#installation) · [Usage reference](docs/reference.en.md) · [Changelog](CHANGELOG.md)

**`0.4.1`: review before remembering.** This release adds pending memories, source checks, and correction previews. See the [release notes](https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.4.1).

![Pending memories inside DSH, shown with Chinese UI and example data](docs/images/pending-memories.png)

## What changed in 0.4.1

There is a new **review before saving** workflow.

Suppose a project used MySQL and you tell the assistant it has moved to PostgreSQL. The assistant can propose an update first. You check its interpretation and destination, then decide whether to save it.

| What you can do | What changed |
|---|---|
| Review a suggestion first | Pending suggestions do not enter active memory until confirmed. Dismiss the ones you do not want. |
| Inspect its source | A suggestion can include a session and quoted excerpt. Only excerpts matched against recently observed direct user messages receive a matched label. A text match does not prove the interpretation is correct. |
| Choose where it belongs | Keep general preferences in user memory and project facts in the source project. Project memory is not supplied to other projects. |
| Correct an existing fact | Reuse its name to compare the old and proposed content. Once confirmed, normal reads use the new content; history retains the old text. |

![Comparing existing and proposed memory before confirmation](docs/images/candidate-review-light.png)

This is an additional workflow. Direct saving remains available, and the plugin does not automatically turn every conversation into suggestions.

## Try it in a minute

1. In a DSH session with a project directory, ask:

   > Use memory_propose to propose a memory: this project has migrated to PostgreSQL, so future SQL examples should use PostgreSQL syntax. Use workspace scope; do not save it directly yet.

2. Open **Plugins → dsh-tool-user-memory → 管理记忆 → 待确认**.
3. Choose **核对并保存**, then check the content, source, and scope. Edit the content if needed.
4. Select **预览变更** to preview the change, then **确认保存** to save. You can cancel or dismiss it instead.
5. Start a fresh session in the same project and ask the assistant to check the saved database convention.

To try a correction, first create a project memory with the same name and the content “This project uses MySQL.” The review then shows the old and new values.

For an explicit direct save, you can still ask the assistant to use `memory_update` to remember a stable preference.

## Keep different kinds of memory separate

- **User memory:** language, communication style, and other preferences shared across projects.
- **Project memory:** technical choices, conventions, and background for one project.
- **Pending review:** inactive suggestions waiting for your decision.
- **Migration:** export, map projects, preview, import, and undo an import if necessary.

Pin important user memories to give them display, retention, and prompt priority. A length budget still limits how much can reach the model at once.

The manager follows DSH colors and fonts in light and dark modes. Confirmation actions stay at the bottom of the dialog, including in narrow windows.

![Memory review following DSH dark mode](docs/images/candidate-review-dark.png)

## Installation

### Published stable release

With DSH installed:

```sh
dsh plugin --profile web add dsh-tool-user-memory@0.4.1
```

Version `0.4.1` includes the review workflow described above, alongside management, pins, project isolation, and migration.

### Build from source

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm pack
dsh plugin --profile web add ./dsh-tool-user-memory-0.4.1.tgz
```

Replace `web` with your actual profile. Restart DSH after installation or an upgrade; refreshing the browser alone does not reload the host plugin.

Version `0.4.1` puts **管理记忆** directly on its plugin detail page. Version `0.4.0` may require opening the component configuration first.

Existing memories remain readable. Version `0.4.1` adds provenance metadata: keep a pre-upgrade backup before downgrading and do not rewrite newer data with an older CLI.

## Before you use it

- Saving a memory, supplying it to the model, and the model actually following it are separate outcomes. Check both stored content and the resulting answer.
- Local storage does not mean offline model processing. Relevant memory is sent to the configured model service with the request; do not store credentials.
- Removing active memory can leave history and backup copies. See the reference for recovery and complete removal.
- Retrieval currently uses keywords. Semantic search, automatic extraction of all past conversations, and encrypted synchronization are not implemented.

## Further reading

| Document | What it covers |
|---|---|
| [Usage and configuration](docs/reference.en.md) | Pins, migration, capacity, tool parameters, storage, and troubleshooting |
| [Candidate review](docs/candidate-review.md) | Source matching, corrections, and recovery; Chinese |
| [Development and verification](docs/development.md) | Build commands, test results, and browser validation; Chinese |
| [Changelog](CHANGELOG.md) | Changes by version |
| [Roadmap](ROADMAP.md) | Planned work |

Version `0.4.1` passes **139 automated tests and the build**. A separate DSH `0.2.1-rc.2` web instance verified the actual manager entry, review workflow, theme changes, and narrow layout. Screenshots use example data; long-term behavior with real models still needs evaluation.

Questions and suggestions are welcome in [Issues](https://github.com/IAMLieutenant/dsh-tool-user-memory/issues). Licensed under [MIT](LICENSE).
