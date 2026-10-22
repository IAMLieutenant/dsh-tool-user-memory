# dsh-tool-user-memory

[![npm][npm-badge]][npm] [![CI][ci-badge]][ci] [![MIT][license-badge]][license]

A user memory plugin for DeepSeek Harness. It saves personal background and preferences so new conversations can use them too.

[中文说明][chinese] · [Download 0.4.2][release] · [Changelog][changelog]

## Features

Tell the assistant about yourself as you normally would, such as your professional background or preferred language. Clear personal information can be saved automatically, with a short notice and an Undo button below the answer.

The manager lets you search, add, edit and delete memories. A single switch turns memory on or off.

You can review suggestions before saving them in the pending list. Export and import let you back up your data or move it to another computer.

![Memory manager][memory-image]

## Install

Install DeepSeek Harness first, then download `dsh-tool-user-memory-0.4.2.tgz` from the [0.4.2 release][release]. Run this command in your download folder and restart DSH afterwards.

```sh
dsh plugin --profile web add ./dsh-tool-user-memory-0.4.2.tgz
```

The example uses the `web` profile. Replace it with your profile name if needed.

## Use

Open Plugins in DSH, find this plugin and click 管理记忆. Saved memories appear in the list, and 新增记忆 adds one manually.

You do not need to explicitly ask the assistant to remember every personal fact. Clear background, skill familiarity, language and communication preferences can be saved automatically, and the Undo button removes a mistaken addition.

When enabled, saved memories are included in later conversations. Pending suggestions take effect after you save them, and replacements show the old and new content before confirmation.

## What gets saved

Only information about you belongs in automatic memory. Project settings, coding constraints, release procedures and temporary requests are skipped, as are unclear statements.

Data is stored locally and sent to your configured model provider when used. Turning memory off or deleting it affects future reads, while existing conversations and backups remain.

## Build from source

Clone the repository, install dependencies and build the plugin. Replace the installation path with your checkout's absolute path.

```sh
pnpm install --frozen-lockfile
pnpm run build
dsh plugin --profile web add "link:/absolute/path/dsh-tool-user-memory"
```

Windows paths can use forward slashes, such as `D:/projects/dsh-tool-user-memory`. Restart DSH after rebuilding.

[npm-badge]: https://img.shields.io/npm/v/dsh-tool-user-memory
[npm]: https://www.npmjs.com/package/dsh-tool-user-memory
[ci-badge]: https://github.com/IAMLieutenant/dsh-tool-user-memory/actions/workflows/ci.yml/badge.svg
[ci]: https://github.com/IAMLieutenant/dsh-tool-user-memory/actions/workflows/ci.yml
[license-badge]: https://img.shields.io/badge/license-MIT-blue
[license]: LICENSE
[chinese]: README.md
[release]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.4.2
[changelog]: CHANGELOG.md
[memory-image]: docs/images/user-memory-list.png
