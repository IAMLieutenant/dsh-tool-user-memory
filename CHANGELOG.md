# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- README (中文 + English) fully rewritten as a user journey: project intro →
  install → verify → usage (remember / read / forget / cross-session demo) →
  where the memory lives → tool reference → development → roadmap.

## [0.1.0] — 2026-08-14

### Added

- `memory_get(query?, limit?)` and `memory_update(key, value, mode?)` model-facing
  tools, registered through `ctx.tools.register(defineTool(...))`.
- System-prompt injection via the `{{user_profile}}` prompt variable: every turn of
  every session carries the current user profile; an empty profile renders to an
  empty section, so there is zero token cost until something is recorded.
- Durable storage in a single Markdown file at `$DSH_HOME/user-memory/user.md`
  (configurable via `path`): atomic writes (tmp file + rename), owner-only
  permissions, `maxBytes` head/tail truncation, reserved `updated-at` key.
- Anti-prompt-injection framing: the injected profile is labelled reference data,
  not instructions (same stance as `dsh-session-reference` snapshots).
- Bundle activation: `cordis.patch.yml` + `dsh.bundle.patch` so `dsh plugin --profile <name> add dsh-tool-user-memory`
  installs AND activates the plugin as a profile layer.
- Test suite (21 tests): pure profile unit tests, real-file store integration
  tests, harness integration tests against a real cordis Context
  (`dsh-agent-loop-testkit`), and a full agent-loop test with a scripted LLM
  adapter (tool-call turn + final-answer turn).

### Verified

- `dsh plugin --profile headless add <tarball>` activates the bundle layer.
- A real headless session (dsh 0.1.0-rc.6, DeepSeek model) persisted a preference
  through `memory_update`.
- A brand-new session answered from the injected `{{user_profile}}` without
  calling any tool.

[0.1.0]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.1.0
