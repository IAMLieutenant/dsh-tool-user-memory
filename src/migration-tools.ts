import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import { applyMemoryImport, exportMemoryFile, previewMemoryImport,
  type ConflictPolicy, type MigrationOptions, type ProjectMapping } from './migration.ts';

function json(value: unknown): Record<string, JsonValue> { return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>; }
function render(_args: unknown, value: unknown) {
  return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }];
}

export function registerMigrationTools(ctx: Context, options: MigrationOptions & { allowed?: () => boolean }): void {
  ctx.tools.register(defineTool({
    name: 'memory_export',
    description: 'Export local user memory to a portable JSON file ONLY when the user asks to export or migrate memory. Includes timestamps and invalidated entries. All stored projects are exported by default, even when their old working directories are gone. Returns counts and project IDs, not memory contents. Never uploads the file. Refuses to overwrite an existing destination.',
    parameters: {
      destination: { type: 'string', required: true, description: 'User-selected local JSON file path, e.g. C:\\Users\\me\\Desktop\\dsh-memory.json' },
      scope: { type: 'string', enum: ['all', 'global'], description: 'all (default): profile and all stored projects; global: profile only' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render },
    async execute(args: { destination: string; scope?: 'all' | 'global' }): Promise<Record<string, JsonValue>> {
      if (options.allowed && !options.allowed()) return { ok: false, error: '模型端迁移兼容工具已停用，请使用管理页或 CLI。' };
      try { return json({ ok: true, ...await exportMemoryFile(args.destination, options, args.scope ?? 'all') }); }
      catch (error) { return { ok: false, error: String((error as Error).message ?? error) }; }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'memory_import',
    description: 'Preview or apply a user-requested memory migration from a local JSON file. Preview is the default and does not write memory. Show the added/conflicting/unmapped counts to the user before applying. Apply ONLY after the user confirms that preview, passing dryRun=false and its previewToken. Unmapped projects are skipped: ask which local project directory each exported ID should map to. keep-local is the default conflict policy. Preserves timestamps/invalidation, rejects capacity overflow without eviction, and backs up every changed file before writing. A changed source, options or destination invalidates the preview token.',
    parameters: {
      source: { type: 'string', required: true, description: 'Local path to the transferred dsh-memory.json' },
      includeProfile: { type: 'boolean', description: 'Import global profile, default true' },
      projectMap: { type: 'array', description: 'Explicit exported-project ID to local directory mappings; unmapped projects stay untouched',
        items: { type: 'object', properties: { id: { type: 'string', required: true }, path: { type: 'string', required: true } }, additionalProperties: false } },
      policy: { type: 'string', enum: ['keep-local', 'use-imported'], description: 'Same-key conflict handling: keep-local (default) or use-imported' },
      dryRun: { type: 'boolean', description: 'true (default): preview; false: apply the confirmed preview' },
      previewToken: { type: 'string', description: 'Exact token returned by the confirmed preview; required when dryRun=false' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render },
    async execute(args: { source: string; includeProfile?: boolean; projectMap?: ProjectMapping[]; policy?: ConflictPolicy; dryRun?: boolean; previewToken?: string }): Promise<Record<string, JsonValue>> {
      if (options.allowed && !options.allowed()) return { ok: false, error: '模型端迁移兼容工具已停用，请使用管理页或 CLI。' };
      const config = { ...options, includeProfile: args.includeProfile, projectMap: args.projectMap, policy: args.policy };
      try {
        return json({ ok: true, ...(args.dryRun === false
          ? await applyMemoryImport(args.source, args.previewToken ?? '', config)
          : { ...await previewMemoryImport(args.source, config), applied: false }) });
      } catch (error) { return { ok: false, error: String((error as Error).message ?? error) }; }
    },
  }));
}
