import path from "node:path";
import { fileURLToPath } from "node:url";

export function pluginRootFrom(importMetaUrl) {
  const file = fileURLToPath(importMetaUrl);
  return path.resolve(path.dirname(file), "..");
}

export function resolveProjectPath(value, baseDir = process.cwd()) {
  return path.resolve(baseDir, String(value));
}

export function projectWorkspacesRoot(baseDir = process.cwd()) {
  return path.resolve(baseDir, "workspaces");
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      args._ = [...(args._ ?? []), item];
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

export function requireArg(args, key) {
  const value = args[key];
  if (!value || value === true) {
    throw new Error(`Missing required --${key} argument.`);
  }
  return String(value);
}

export function asNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
