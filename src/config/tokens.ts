import { registerSecret } from "../util/redact.js";

function firstEnv(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) {
      const token = value.trim();
      registerSecret(token);
      return token;
    }
  }
  return null;
}

/** Azure DevOps PAT. Scopes needed: Work Items (Read & Write), Code (Read & Write for push/PR). */
export function adoPat(): string | null {
  return firstEnv("BUGZINGA_ADO_PAT", "AZURE_DEVOPS_EXT_PAT", "ADO_PAT");
}

/** GitHub token. Scopes needed: repo (issues read, contents read, PR write if enabled). */
export function githubToken(): string | null {
  return firstEnv("BUGZINGA_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN");
}

export const ADO_PAT_ENV_VARS = ["BUGZINGA_ADO_PAT", "AZURE_DEVOPS_EXT_PAT", "ADO_PAT"];
export const GITHUB_TOKEN_ENV_VARS = ["BUGZINGA_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"];
