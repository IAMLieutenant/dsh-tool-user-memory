/**
 * dsh-tool-user-memory — user preference memory for DeepSeek Harness.
 *
 * A Cordis plugin that gives the agent a persisted, cross-session memory of
 * user preferences:
 *   - `memory_get` / `memory_update` / `memory_search` / `memory_topic` /
 *     `memory_consolidate` model-facing tools
 *   - a `{{user_profile}}` system-prompt variable injected every turn
 *   - a per-workspace memory layer (regenerable index + topic files)
 *     under $DSH_HOME, resolved from the session's cwd
 *   - background consolidation ("dreaming") at turn boundaries plus a manual
 *     tool, with an auditable consolidation log
 *
 * The profile lives in a single Markdown file under $DSH_HOME (global,
 * human-readable, deletable = forgetting).
 */

import z from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
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
import { registerProfilePrompt } from './prompt.ts';
import { createWorkspaceMemory } from './workspace.ts';
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
    .description("Inject the user profile into every session's system prompt"),
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
  projectPath: z.string().default('').description('Explicit existing project directory; overrides session cwd and workspaceMode'),
  autoConsolidate: z
    .boolean()
    .default(false)
    .description('Run a background consolidation pass at agent turn boundaries (debounced by consolidateMinIntervalMs)'),
  consolidateMinIntervalMs: z
    .number()
    .min(0)
    .default(DEFAULT_CONSOLIDATE_MIN_INTERVAL_MS)
    .description('Minimum interval between automatic consolidation runs; 0 = every turn boundary'),
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
    config.includeInPrompt !== false,
    config.promptMaxBytes ?? DEFAULT_PROMPT_MAX_BYTES,
    staleAfterDays,
    config.workspacePromptMaxBytes ?? DEFAULT_WORKSPACE_PROMPT_MAX_BYTES,
    workspaceBase,
    config.workspaceMode,
    config.projectPath,
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

  registerMemoryTools(ctx, store, { staleAfterDays, workspaceBase, consolidate, maxBytes: config.maxBytes,
    workspaceMode: config.workspaceMode, projectPath: config.projectPath });
  const managerOptions = { profilePath: store.path(), workspaceBase, maxBytes: config.maxBytes,
    workspaceMode: config.workspaceMode, projectPath: config.projectPath, promptMaxBytes: config.promptMaxBytes,
    workspacePromptMaxBytes: config.workspacePromptMaxBytes, includeInPrompt: config.includeInPrompt, staleAfterDays };
  installManagerWeb(ctx, managerOptions);
  const manager = createMemoryManager(managerOptions);
  ctx.tools.register(defineTool({ name: 'memory_status',
    description: 'Diagnose memory storage and project identity using the running plugin configuration. Returns counts and paths, never memory contents. The local web manager is available at /_dsh/user-memory on the DSH web server. No model calls are made.',
    parameters: {}, output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    async execute(_args: {}, exec: { agent?: { session?: { header?: { cwd?: string } } } }) {
      try { return JSON.parse(JSON.stringify({ ok: true, ...await manager.diagnose(exec.agent?.session?.header?.cwd), managerPath: '/_dsh/user-memory' })); }
      catch (error) { return { ok: false, error: (error as Error).message }; }
    },
  }));

  if (config.autoConsolidate === true) {
    const minInterval = config.consolidateMinIntervalMs ?? DEFAULT_CONSOLIDATE_MIN_INTERVAL_MS;
    let lastRunAt = 0;
    let running = false;
    const runInBackground = async (agent: Agent | undefined): Promise<void> => {
      if (running) return;
      if (minInterval > 0 && Date.now() - lastRunAt < minInterval) return;
      running = true;
      lastRunAt = Date.now();
      try {
        const cwd = config.projectPath || agent?.session?.header?.cwd;
        const ws =
          typeof cwd === 'string' && cwd !== ''
            ? await createWorkspaceMemory({ cwd, baseDir: workspaceBase, mode: config.workspaceMode, projectPath: config.projectPath })
            : null;
        await consolidate({
          source: 'turn',
          mode: 'apply',
          useModel: modelConfigured,
          workspace: ws,
          ...(ws === null ? {} : { workspacePath: ws.path }),
        });
      } catch {
        // Background work must never surface into the session.
      } finally {
        running = false;
      }
    };
    ctx.on('agent/turn-stopping', (payload) => {
      // Fire-and-forget: consolidation must not delay the turn boundary.
      void runInBackground(payload?.agent);
    });
  }
}
