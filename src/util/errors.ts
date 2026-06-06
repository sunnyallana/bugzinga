export class BugzingaError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ConfigError extends BugzingaError {}
export class QueryError extends BugzingaError {}
export class TrackerError extends BugzingaError {}
export class AgentError extends BugzingaError {}
export class GitError extends BugzingaError {}
export class ExecError extends BugzingaError {}
export class PipelineError extends BugzingaError {}

export function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
