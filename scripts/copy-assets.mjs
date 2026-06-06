// Copies non-TS assets (prompt templates) into dist/ after tsc.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "src", "prompts", "templates");
const dest = join(root, "dist", "prompts", "templates");

mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`copied prompt templates -> ${dest}`);
