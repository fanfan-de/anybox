import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function runWorker(action, payload, options = {}) {
  const pluginRoot = options.pluginRoot;
  const timeoutMs = options.timeoutMs ?? 15000;
  const workerPath = path.resolve(pluginRoot, "scripts/internal/run_slide_worker.mjs");
  const encodedPayload = JSON.stringify({ action, ...payload });

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, encodedPayload], {
      cwd: pluginRoot,
      env: workerEnv(process.env),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Slide worker timed out after ${timeoutMs}ms.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Slide worker exited with code ${code}.`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Slide worker returned invalid JSON: ${error.message}\n${stdout}\n${stderr}`));
      }
    });
  });
}

export function currentScriptDir(importMetaUrl) {
  return path.dirname(fileURLToPath(importMetaUrl));
}

function workerEnv(env) {
  const allowed = {};
  for (const key of ["PATH", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR"]) {
    if (env[key]) allowed[key] = env[key];
  }
  return allowed;
}
