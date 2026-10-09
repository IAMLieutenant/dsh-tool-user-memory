/**
 * Model-facing tools: `memory_get` (read the user profile) and
 * `memory_update` (record a stable user preference).
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import { renderEntries, type MergeMode, type RenderOptions } from './profile.ts';
import type { MemoryStore } from './store.ts';

/** Read a field off a JSON-schema-typed render value defensively. */
function fieldOf(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null) return '';
  const record = value as Record<string, unknown>;
  const field = record[key];
  return field === undefined ? '' : String(field);
}

function isOk(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>).ok === true;
}

function evictedOf(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [];
  const evicted = (value as Record<string, unknown>).evicted;
  return Array.isArray(evicted) ? evicted.map((item) => String(item)) : [];
}

export function registerMemoryTools(ctx: Context, store: MemoryStore, staleAfterDays = 0): void {
  const profilePath = store.path();

  ctx.tools.register(
    defineTool({
      name: 'memory_get',
      description: [
        'Read the user preference memory (persisted across sessions).',
        'Call this when you need to personalise a response: preferred language,',
        'communication style, project background, or any previously recorded preference.',
        'Invalidated (superseded) entries are hidden by default; pass includeStale=true to audit them.',
        `Profile file: ${profilePath}`,
      ].join('\n'),
      parameters: {
        query: { type: 'string', description: 'Optional keyword; filters entries by key or value' },
        limit: { type: 'number', description: 'Max entries to return (default 50, max 100)' },
        includeStale: {
          type: 'boolean',
          description:
            'Also return invalidated entries (clearly marked); default false. Use for auditing what was superseded.',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: fieldOf(value, 'rendered') }],
      },
      async execute(args: {
        query?: string;
        limit?: number;
        includeStale?: boolean;
      }): Promise<Record<string, JsonValue>> {
        const entries = await store.list();
        const query = (args.query ?? '').trim().toLowerCase();
        const matches = (entry: { key: string; value: string }): boolean =>
          query === '' ||
          entry.key.toLowerCase().includes(query) ||
          entry.value.toLowerCase().includes(query);
        const valid = entries.filter((entry) => !entry.invalidatedAt && matches(entry));
        const invalidated = entries.filter((entry) => entry.invalidatedAt && matches(entry));
        const combined = args.includeStale ? [...valid, ...invalidated] : valid;
        const limit = Math.max(0, Math.min(args.limit ?? 50, 100));
        const slice = combined.slice(0, limit);
        const options: RenderOptions = { now: new Date().toISOString(), staleAfterDays };
        const body = renderEntries(slice, options);
        // Canonical value stays scalar + rendered text; the model sees `rendered`.
        return {
          ok: true,
          total: combined.length,
          invalidated: invalidated.length,
          rendered: body === '' ? '(no user memory recorded yet)' : body,
        };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'memory_update',
      description: [
        'Record a user preference into the persisted user memory.',
        'Call this when the user expresses a STABLE, long-term preference, introduces',
        'themselves or their project, or states a goal ("I prefer short answers",',
        '"I work on RAG retrieval", "my goal is to contribute to the harness").',
        'Do NOT store one-off requests, and NEVER store credentials, passwords or tokens.',
        'When a recorded preference is SUPERSEDED (project/role/goal changed), prefer',
        'mode=invalidate over remove: the old entry stays in the file for audit (marked',
        'with date + reason) but is hidden from the prompt and from memory_get.',
        'Calling set or append on an invalidated key revives it.',
        `Profile file: ${profilePath}`,
      ].join('\n'),
      parameters: {
        key: {
          type: 'string',
          required: true,
          description:
            'Preference key, e.g. language, communication-style, project-background',
        },
        value: {
          type: 'string',
          required: true,
          description: 'Preference content (pass "" for mode=invalidate and mode=remove)',
        },
        mode: {
          type: 'string',
          enum: ['set', 'append', 'remove', 'invalidate'],
          description:
            'set (default) replaces and revives, append adds a line, remove deletes the key, invalidate soft-deletes it (keeps history, hides it from the prompt)',
        },
        reason: {
          type: 'string',
          description:
            'For mode=invalidate: why the memory is no longer correct (e.g. "superseded by project-agent-platform"). Stored with the entry for audit.',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          if (!isOk(value)) {
            return [{ type: 'text', text: `memory update failed: ${fieldOf(value, 'error') || 'unknown error'}` }];
          }
          const evicted = evictedOf(value);
          const mode = fieldOf(value, 'mode');
          const text =
            mode === 'invalidate'
              ? `memory invalidated (${fieldOf(value, 'key')}) — kept in file for audit, hidden from the prompt`
              : `memory updated (${fieldOf(value, 'key')})` +
                (evicted.length > 0
                  ? `; evicted older entries to stay within limit: ${evicted.join(', ')}`
                  : '');
          return [{ type: 'text', text }];
        },
      },
      async execute(args: {
        key: string;
        value: string;
        mode?: MergeMode;
        reason?: string;
      }): Promise<Record<string, JsonValue>> {
        const result = await store.update(args.key, args.value, args.mode ?? 'set', args.reason ?? '');
        return result.ok
          ? {
              ok: true,
              key: result.key,
              mode: result.mode,
              bytes: result.bytes,
              evicted: result.evicted,
              truncated: result.truncated,
            }
          : {
              ok: false,
              key: result.key,
              mode: result.mode,
              bytes: 0,
              evicted: [],
              truncated: null,
              error: result.error ?? '',
            };
      },
    }),
  );
}
