/**
 * dsh-tool-user-memory — user preference memory for DeepSeek Harness.
 *
 * A Cordis plugin that gives the agent a persisted, cross-session memory of
 * user preferences:
 *   - `memory_get` / `memory_update` model-facing tools
 *   - a `{{userProfile}}` system-prompt variable injected every turn
 *
 * The profile lives in a single Markdown file under $DSH_HOME (global,
 * human-readable, deletable = forgetting).
 */

import z from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
import { DEFAULT_MAX_BYTES, createMemoryStore } from './store.ts';
import { registerMemoryTools } from './tools.ts';
import { registerProfilePrompt } from './prompt.ts';

export const name = 'tool-user-memory';

/** Host services this plugin depends on. */
export const inject = ['tools', 'systemPrompt'];

/** Default per-turn injection budget; 0 injects the full profile. */
export const DEFAULT_PROMPT_MAX_BYTES = 2048;

export const Config = z.object({
  path: z.string().default('').description('Profile file path; defaults to $DSH_HOME/user-memory/user.md'),
  maxBytes: z
    .number()
    .default(DEFAULT_MAX_BYTES)
    .description('Max profile file bytes; oldest entries are evicted first when exceeded'),
  promptMaxBytes: z
    .number()
    .default(DEFAULT_PROMPT_MAX_BYTES)
    .description('Per-turn prompt injection byte budget (newest entries first); 0 injects the full profile'),
  includeInPrompt: z
    .boolean()
    .default(true)
    .description("Inject the user profile into every session's system prompt"),
});

/** Validated config shape (schemastery has no z.infer; kept structural). */
export interface UserMemoryConfig {
  path: string;
  maxBytes: number;
  promptMaxBytes: number;
  includeInPrompt: boolean;
}

export function apply(ctx: Context, config: UserMemoryConfig): void {
  const store = createMemoryStore({ path: config.path, maxBytes: config.maxBytes });
  registerProfilePrompt(
    ctx,
    store,
    config.includeInPrompt !== false,
    config.promptMaxBytes ?? DEFAULT_PROMPT_MAX_BYTES,
  );
  registerMemoryTools(ctx, store);
}
