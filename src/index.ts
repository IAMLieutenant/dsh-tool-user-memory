/**
 * Confirmed user preferences for DeepSeek Harness, carried into future chats.
 * Normal runtime has no project memory, conversation memory or background writes.
 * Old project files are preserved for backup/migration; never promoted to profile.
 */

import z from '@deepseek-ai/schemastery';
import { createMemoryActivity, installMemoryActivity } from './activity.ts';
import { createMemoryPolicy } from './policy.ts';
import type { Context } from '@deepseek-ai/cordis';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import {
  appendConsolidationLog,
  applyPlan,
  describeOp,
  planDeterministic,
  proposeOpsWithModel,
  type ConsolidateOutcome,
  type ConsolidateRequest,
  type LlmLike,
} from './consolidate.ts';
import { DEFAULT_MAX_BYTES, createMemoryStore } from './store.ts';
import { registerMemoryTools } from './tools.ts';
import { registerUserMemoryTools } from './user-tools.ts';
import { registerProfilePrompt } from './prompt.ts';
import { installManagerWeb } from './manager-web.ts';
import { createMemoryManager } from './manager.ts';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'tool-user-memory';

/** Host services this plugin depends on. */
export const inject = ['tools', 'systemPrompt'];

/** Default per-turn injection budget; 0 injects the full profile. */
export const DEFAULT_PROMPT_MAX_BYTES = 2048;

/** Default per-turn injection budget for the workspace memory index; 0 disables it. */
export const DEFAULT_WORKSPACE_PROMPT_MAX_BYTES = 512;

/** Default minimum interval between automatic consolidation runs (10 minutes). */
export const DEFAULT_CONSOLIDATE_MIN_INTERVAL_MS = 600_000;

export const Config = z.object({
  memoryMode: z.union(['project', 'shared', 'paused']).default('project').description('project: current project notes only; shared: also allow cross-project preferences; paused: block model access'),
  recordRequests: z.boolean().default(false).description('Opt-in diagnostic receipts; off by default. Can be changed in the manager.'),
  legacyTools: z.boolean().default(false).description('Compatibility only: expose the old direct-write, migration and manual consolidation tools; not recommended for normal use'),
  path: z.string().default('').description('Profile file path; defaults to $DSH_HOME/user-memory/user.md'),
  maxBytes: z
    .number()
    .min(1)
    .max(16 * 1024 * 1024)
    .default(DEFAULT_MAX_BYTES)
    .description('Integer profile byte limit; complete entries are archived before eviction or truncation'),
  promptMaxBytes: z
    .number()
    .default(DEFAULT_PROMPT_MAX_BYTES)
    .description('Per-turn prompt injection byte budget (pinned entries first, then newest); 0 injects all valid entries'),
  includeInPrompt: z
    .boolean()
    .default(true)
    .description('Enable confirmed user preferences in future conversations. Can be toggled in the manager.'),
  staleAfterDays: z
    .number()
    .min(0)
    .default(0)
    .description(
      'Entries not updated within N days are annotated [stale] in the prompt and memory_get (annotation only, never a deletion); 0 disables aging',
    ),
  workspacePromptMaxBytes: z
    .number()
    .min(0)
    .default(DEFAULT_WORKSPACE_PROMPT_MAX_BYTES)
    .description(
      'Per-turn byte budget for the workspace memory index injected into the prompt (topic bodies stay lazy, fetched via memory_topic); 0 disables workspace injection',
    ),
  workspaceBase: z
    .string()
    .default('')
    .description('Override the workspace memory base directory (defaults to $DSH_HOME/user-memory/workspace); mainly for testing'),
  workspaceMode: z.union(['directory', 'git-root']).default('directory').description('Project identity: directory (compatible default) or nearest Git root'),
  projectPath: z.string().default('').description('Compatibility/CLI only: ignored by normal model tools; session cwd determines the project'),
  autoConsolidate: z
    .boolean()
    .default(false)
    .description('Retired setting: ignored. Automatic consolidation no longer runs.'),
  consolidateMinIntervalMs: z
    .number()
    .min(0)
    .default(DEFAULT_CONSOLIDATE_MIN_INTERVAL_MS)
    .description('Retired setting: ignored; automatic consolidation no longer runs'),
  autoInvalidateAfterDays: z
    .number()
    .min(0)
    .default(0)
    .description(
      'Consolidation invalidates entries not updated for N days (they stay in the file for audit); 0 = never auto-invalidate',
    ),
  consolidateProvider: z
    .string()
    .default('')
    .description('Provider route for the optional model-assisted consolidation pass (e.g. deepseek)'),
  consolidateModel: z
    .string()
    .default('')
    .description('Model id for the optional model-assisted consolidation pass'),
  consolidateMaxTokens: z
    .number()
    .min(0)
    .default(1024)
    .description('Max output tokens for one consolidation model call'),
  consolidationLogPath: z
    .string()
    .default('')
    .description('Consolidation log path; defaults to $DSH_HOME/user-memory/consolidation-log.md'),
});

/** Validated config shape (schemastery has no z.infer; kept structural). */
export interface UserMemoryConfig {
  memoryMode?: 'project' | 'shared' | 'paused';
  recordRequests?: boolean;
  legacyTools?: boolean;
  path: string;
  maxBytes: number;
  promptMaxBytes: number;
  includeInPrompt: boolean;
  staleAfterDays: number;
  workspacePromptMaxBytes: number;
  workspaceBase: string;
  workspaceMode?: 'directory' | 'git-root';
  projectPath?: string;
  autoConsolidate: boolean;
  consolidateMinIntervalMs: number;
  autoInvalidateAfterDays: number;
  consolidateProvider: string;
  consolidateModel: string;
  consolidateMaxTokens: number;
  consolidationLogPath: string;
}

export function apply(ctx: Context, config: UserMemoryConfig): void {
  const store = createMemoryStore({ path: config.path, maxBytes: config.maxBytes });
  const userOnly = config.legacyTools !== true;
  const policy = createMemoryPolicy(store.path(), userOnly
    ? { mode: config.includeInPrompt === false ? 'paused' : 'shared', inject: config.includeInPrompt !== false, diagnostics: false }
    : { mode: config.memoryMode ?? 'shared', inject: config.includeInPrompt === true, diagnostics: config.recordRequests === true }, userOnly);
  const activity = createMemoryActivity(store.path(), () => { const p = policy.read(); return p.diagnostics && p.mode !== 'paused'; });
  if (userOnly) ctx.on('session/event', (session, event) => activity.observe(session, event));
  else installMemoryActivity(ctx, activity);
  const staleAfterDays = config.staleAfterDays ?? 0;
  const workspaceBase = config.workspaceBase ?? '';
  const autoInvalidateAfterDays = config.autoInvalidateAfterDays ?? 0;
  const provider = (config.consolidateProvider ?? '').trim();
  const model = (config.consolidateModel ?? '').trim();
  const maxTokens = config.consolidateMaxTokens ?? 1024;
  const logPath =
    (config.consolidationLogPath ?? '').trim() === ''
      ? dshHomePath('user-memory', 'consolidation-log.md')
      : (config.consolidationLogPath ?? '').trim();
  // Resolved structurally through the optional-accessor so the plugin carries
  // no hard llm dependency (declaring `llm` in `inject` would keep the whole
  // plugin dormant in contexts without a model runtime): the model-assisted
  // pass simply stays off when no llm service is mounted.
  const llm = ctx.get('llm') as LlmLike | undefined;
  const modelConfigured = provider !== '' && model !== '' && llm !== undefined;

  registerProfilePrompt(
    ctx,
    store,
    config.includeInPrompt === true,
    config.promptMaxBytes ?? DEFAULT_PROMPT_MAX_BYTES,
    staleAfterDays,
    config.workspacePromptMaxBytes ?? DEFAULT_WORKSPACE_PROMPT_MAX_BYTES,
    workspaceBase,
    config.workspaceMode,
    config.legacyTools ? config.projectPath : '',
    activity,
    policy,
    userOnly,
  );

  /**
   * One consolidation run: deterministic rules always, the model layer only
   * when asked and configured. `mode: 'plan'` never writes.
   */
  async function consolidate(request: ConsolidateRequest): Promise<ConsolidateOutcome> {
    const now = new Date().toISOString();
    const entries = await store.list();
    const topics = request.workspace === null ? [] : await request.workspace.list();
    const plan = planDeterministic({ entries, topics, now, staleAfterDays, autoInvalidateAfterDays });
    let modelError: string | undefined;

    if (request.useModel) {
      if (!modelConfigured) {
        modelError = 'no consolidation model configured (set consolidateProvider + consolidateModel)';
      } else if (llm !== undefined) {
        const proposal = await proposeOpsWithModel(
          llm,
          { provider, model, maxTokens },
          { entries, topics, now },
        );
        if (proposal.error !== undefined) modelError = proposal.error;
        const known = new Set(plan.ops.map(describeOp));
        for (const op of proposal.ops) {
          const label = describeOp(op);
          if (known.has(label)) continue;
          known.add(label);
          plan.ops.push(op);
        }
        if (proposal.dropped > 0) plan.notes.push(`${proposal.dropped} model op(s) dropped as invalid`);
      }
    }

    if (request.mode === 'plan') {
      return {
        plan,
        mode: request.mode,
        record: {
          at: now,
          source: request.source,
          ...(request.workspacePath === undefined ? {} : { workspace: request.workspacePath }),
          applied: [],
          skipped: [],
          notes: plan.notes,
        },
        ...(modelError === undefined ? {} : { modelError }),
      };
    }

    const record = await applyPlan(
      store,
      request.workspace,
      plan,
      request.source,
      request.workspacePath,
    );
    // The log is the audit trail; a log failure must not undo memory writes.
    await appendConsolidationLog(logPath, record).catch(() => undefined);
    return { plan, record, mode: request.mode, ...(modelError === undefined ? {} : { modelError }) };
  }

  if (userOnly) registerUserMemoryTools(ctx, store, policy);
  else registerMemoryTools(ctx, store, { staleAfterDays, workspaceBase, consolidate, maxBytes: config.maxBytes,
    workspaceMode: config.workspaceMode, projectPath: config.projectPath, activity, policy, legacyTools: true });
  const managerOptions = { profilePath: store.path(), workspaceBase, maxBytes: config.maxBytes,
    workspaceMode: config.workspaceMode, projectPath: config.legacyTools ? config.projectPath : '', promptMaxBytes: config.promptMaxBytes,
    workspacePromptMaxBytes: config.workspacePromptMaxBytes, includeInPrompt: config.includeInPrompt, staleAfterDays, activity, usagePolicy: policy, userOnly };
  installManagerWeb(ctx, managerOptions);
  const manager = createMemoryManager(managerOptions);
  ctx.tools.register(defineTool({ name: 'memory_status',
    description: 'Check whether user memory is enabled and how many saved preferences exist. No memory content is returned.',
    parameters: {}, output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    async execute(_args: {}, exec: { agent?: { session?: { header?: { cwd?: string } } } }) {
      if (userOnly) return { ok: true, enabled: policy.read().mode === 'shared' && policy.read().inject, entries: (await store.list()).filter(e => !e.invalidatedAt).length };
      try { return JSON.parse(JSON.stringify({ ok: true, ...await manager.diagnose(exec.agent?.session?.header?.cwd, !config.legacyTools), managerPath: '/_dsh/user-memory' })); }
      catch (error) { return { ok: false, error: (error as Error).message }; }
    },
  }));

}
