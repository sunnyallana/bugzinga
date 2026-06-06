import type { ResolvedConfig } from "../config/load.js";
import {
  adoPat,
  ADO_PAT_ENV_VARS,
  githubToken,
  GITHUB_TOKEN_ENV_VARS,
} from "../config/tokens.js";
import { ConfigError } from "../util/errors.js";
import { AzureDevOpsTracker } from "./azure.js";
import { GithubTracker } from "./github.js";
import type { BugTracker } from "./types.js";

export type { BugTracker, PullRequestRequest } from "./types.js";

export function createTracker(config: ResolvedConfig): BugTracker {
  if (config.tracker.kind === "azure") {
    const pat = adoPat();
    if (!pat) {
      throw new ConfigError(
        `No Azure DevOps PAT found. Set one of: ${ADO_PAT_ENV_VARS.join(", ")}.\n` +
          "Create a PAT with Work Items (Read & Write) and Code (Read & Write) scopes at " +
          `${config.tracker.baseUrl}/${config.tracker.organization}/_usersSettings/tokens`,
      );
    }
    return new AzureDevOpsTracker(config.tracker, pat);
  }
  const token = githubToken();
  if (!token) {
    throw new ConfigError(
      `No GitHub token found. Set one of: ${GITHUB_TOKEN_ENV_VARS.join(", ")} ` +
        "(classic PAT with repo scope, or a fine-grained token with Issues read/write + Contents read + Pull requests write).",
    );
  }
  return new GithubTracker(config.tracker, token);
}
