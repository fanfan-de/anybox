import readline from "node:readline";
import { spawn } from "node-pty";

let term = null;

function send(payload) {
  return process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sendAndExit(payload, code = 0) {
  process.stdout.write(`${JSON.stringify(payload)}\n`, () => {
    process.exit(code);
  });
}

function fail(message) {
  send({
    type: "error",
    message,
  });
}

function failAndExit(message, code = 1) {
  sendAndExit({
    type: "error",
    message,
  }, code);
}

function disposeAndExit(code = 0) {
  if (term) {
    try {
      term.kill();
    } catch {
      // The PTY may already be gone.
    }
    term = null;
  }

  process.exit(code);
}

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

input.on("line", (line) => {
  let message;

  try {
    message = JSON.parse(line);
  } catch {
    fail("Worker command must be valid JSON text");
    return;
  }

  if (message.type === "start") {
    if (term) {
      fail("PTY worker is already started");
      return;
    }

    try {
      term = spawn(message.executable, Array.isArray(message.args) ? message.args : [], {
        name: "xterm-256color",
        cwd: message.cwd,
        cols: message.cols,
        rows: message.rows,
        env: message.env,
        useConpty: process.platform === "win32" ? true : undefined,
      });
    } catch (error) {
      failAndExit(error instanceof Error ? error.message : String(error));
      return;
    }

    term.onData((data) => {
      send({
        type: "data",
        data,
      });
    });

    term.onExit((event) => {
      term = null;
      sendAndExit({
        type: "exit",
        exitCode: event.exitCode ?? null,
        signal: event.signal,
      });
    });

    send({
      type: "ready",
      pid: term.pid,
    });
    return;
  }

  if (!term) {
    fail("PTY worker has not started yet");
    return;
  }

  if (message.type === "write") {
    try {
      term.write(message.data);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (message.type === "resize") {
    try {
      term.resize(message.cols, message.rows);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (message.type === "kill") {
    try {
      term.kill();
    } catch {
      disposeAndExit(0);
    }
    return;
  }

  fail(`Unknown worker command: ${String(message.type)}`);
});

input.on("close", () => {
  disposeAndExit(0);
});

process.on("SIGTERM", () => {
  disposeAndExit(0);
});

process.on("SIGINT", () => {
  disposeAndExit(0);
});
