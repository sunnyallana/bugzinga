import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

/**
 * Crash-safe write: write to a temp file in the same directory, then rename
 * over the target. On Windows the rename can fail transiently if the target
 * is held open (AV scanners, editors) — retry once after removing the target.
 */
export function writeFileAtomic(filePath: string, content: string): void {
  ensureDir(dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, content, "utf8");
  try {
    renameSync(tmp, filePath);
  } catch (err) {
    try {
      rmSync(filePath, { force: true });
      renameSync(tmp, filePath);
    } catch {
      rmSync(tmp, { force: true });
      throw err;
    }
  }
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function readTextIfExists(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf8");
}

export function readJsonIfExists<T>(filePath: string): T | null {
  const text = readTextIfExists(filePath);
  if (text === null) return null;
  // Tolerate the UTF-8 BOM that Windows editors and PowerShell often emit.
  return JSON.parse(text.replace(/^﻿/, "")) as T;
}

export function slugify(value: string, maxLength = 60): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "item";
}
