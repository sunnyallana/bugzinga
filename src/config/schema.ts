import { z } from "zod";
import { PHASES } from "../core/types.js";

/**
 * Raw config file schema. Validation only — defaults are applied by
 * resolveConfig() in load.ts so the rules live in one explicit place.
 */

const azureTrackerSchema = z.object({
  kind: z.literal("azure"),
  organization: z.string().min(1),
  project: z.string().min(1),
  repository: z.string().min(1).optional(),
  baseUrl: z.string().min(1).optional(),
});

const githubTrackerSchema = z.object({
  kind: z.literal("github"),
  owner: z.string().min(1),
  repo: z.string().min(1),
  labels: z
    .object({
      priority: z.string().min(1).optional(),
      severity: z.string().min(1).optional(),
    })
    .optional(),
});

const phaseIdSchema = z.enum(PHASES);

const timeoutsSchema = z.object({
  reproduce: z.number().int().positive().optional(),
  investigate: z.number().int().positive().optional(),
  baseline: z.number().int().positive().optional(),
  propose: z.number().int().positive().optional(),
  fix: z.number().int().positive().optional(),
  validate: z.number().int().positive().optional(),
  report: z.number().int().positive().optional(),
});

const phaseModelsSchema = z.object({
  reproduce: z.string().min(1).optional(),
  investigate: z.string().min(1).optional(),
  baseline: z.string().min(1).optional(),
  propose: z.string().min(1).optional(),
  fix: z.string().min(1).optional(),
  validate: z.string().min(1).optional(),
  report: z.string().min(1).optional(),
});

const mcpServerSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
});

export const configSchema = z.object({
  $schema: z.string().optional(),
  tracker: z.discriminatedUnion("kind", [azureTrackerSchema, githubTrackerSchema]),
  repo: z
    .object({
      url: z.string().min(1).optional(),
      defaultBranch: z.string().min(1).optional(),
      root: z.string().min(1).optional(),
    })
    .optional(),
  agent: z
    .object({
      kind: z.enum(["claude", "cursor", "codex"]).optional(),
      model: z.string().min(1).optional(),
      /** Per-phase model overrides — cheap models for mechanical phases. Wins over `model`. */
      models: phaseModelsSchema.optional(),
      autonomy: z.enum(["edits", "full"]).optional(),
      extraArgs: z.array(z.string()).optional(),
    })
    .optional(),
  bugsRoot: z.string().min(1).optional(),
  build: z
    .object({
      command: z.string().min(1).optional(),
      testCommand: z.string().min(1).optional(),
    })
    .optional(),
  pipeline: z
    .object({
      concurrency: z.number().int().min(1).max(16).optional(),
      maxFixAttempts: z.number().int().min(1).max(10).optional(),
      phaseAttempts: z.number().int().min(1).max(5).optional(),
      reproRequired: z.boolean().optional(),
      revalidateLoops: z.number().int().min(0).max(3).optional(),
      skipPhases: z.array(phaseIdSchema).optional(),
      timeoutMinutes: timeoutsSchema.optional(),
      /** Run the baseline phase as a plain script (no agent) when build.command is set. */
      deterministicBaseline: z.boolean().optional(),
    })
    .optional(),
  delivery: z
    .object({
      autoCommit: z.boolean().optional(),
      push: z.boolean().optional(),
      createPr: z.boolean().optional(),
      comment: z.boolean().optional(),
      branchPrefix: z.string().min(1).optional(),
      prTargetBranch: z.string().min(1).optional(),
    })
    .optional(),
  debugging: z
    .object({
      enabled: z.boolean().optional(),
      /**
       * MCP servers exposed to the agent — debuggers, DB inspectors, API
       * clients, UI drivers, anything. A single object is accepted for
       * backwards compatibility and treated as a one-element list.
       */
      mcp: z.union([mcpServerSchema, z.array(mcpServerSchema)]).optional(),
    })
    .optional(),
  defaultQuery: z.string().min(1).optional(),
});

export type RawConfig = z.infer<typeof configSchema>;
