/**
 * CLI test runner untuk F3 — menjalankan transpile + runner tanpa UI.
 *
 * Usage: node server/test/run-cli.js <scriptDir> [iterations]
 *
 * Contoh: node server/test/run-cli.js samples/core 3
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { fork } from "node:child_process";
import { mkdir } from "node:fs/promises";
import crypto from "node:crypto";

import { compileScript } from "../compiler/transpile.js";
import { loadProject } from "../project/loader.js";
import { cacheDirFor, resolveScriptDir } from "../project/paths.js";
import { saveRun, createRunResult, addStep, addTransaction, addLog, finalizeRun } from "../runs/store.js";
import { startMockServer, stopMockServer } from "./mock.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runCli(scriptDirArg, iterations = 1) {
  const scriptDir = resolve(scriptDirArg);
  console.log(`[cli] Script dir: ${scriptDir}`);
  console.log(`[cli] Iterations: ${iterations}`);

  // Start mock server
  console.log(`[cli] Starting mock server...`);
  await startMockServer(18081);
  // Small delay to ensure server is ready
  await new Promise(r => setTimeout(r, 500));

  // Validate and load project
  const validatedDir = await resolveScriptDir(scriptDir);
  const project = await loadProject(validatedDir);
  console.log(`[cli] Project loaded: ${project.files.length} files, actions: ${project.actions.join(", ")}`);

  // Prepare cache
  const cacheDir = cacheDirFor(validatedDir);
  await mkdir(cacheDir, { recursive: true });
  console.log(`[cli] Cache dir: ${cacheDir}`);

  // Compile
  console.log(`[cli] Compiling...`);
  const compileResult = await compileScript({
    scriptDir,
    cacheDir,
    files: project.files,
  });
  console.log(`[cli] Compiled: ${compileResult.files.length} files, ${compileResult.functions.length} functions`);
  if (compileResult.warnings.length) {
    console.log(`[cli] Warnings:`);
    for (const w of compileResult.warnings) console.log(`  ${w.file}:${w.line} ${w.message}`);
  }

  // Create run
  const runId = new Date().toISOString().replace(/[:.]/g, "-") + "-" + crypto.randomBytes(4).toString("hex");
  const options = {
    iterations,
    continueOnError: false,
    iterationDelayMs: 0,
    newUserEachIteration: true,
    insecureTLS: false,
    thinkTime: "ignore",
    timeoutMs: 60000,
  };

  let runResult = createRunResult({ runId, options });
  let stepSeq = 0;

  // Fork runner
  const runnerPath = resolve(__dirname, "../runtime/runner.js");
  console.log(`[cli] Starting runner: ${runnerPath}`);

  const child = fork(runnerPath, [], { stdio: ["pipe", "pipe", "pipe", "ipc"] });

  // Handle runner events
  child.on("message", (msg) => {
    if (!msg || msg.type !== "event") return;
    const { event } = msg;

    switch (event.type) {
      case "ready":
        console.log(`[cli] Runner ready`);
        child.send({ type: "start", payload: {
          modulePath: compileResult.modulePath,
          scriptDir,
          cacheDir,
          options,
          runId,
        }});
        break;

      case "started":
        console.log(`[cli] Run started: ${event.data.runId}`);
        break;

      case "iterationStart":
        console.log(`[cli] Iteration ${event.data.iteration} ${event.data.action} started`);
        break;

      case "iterationEnd":
        console.log(`[cli] Iteration ${event.data.iteration} ${event.data.action} ${event.data.status}`);
        break;

      case "step": {
        stepSeq++;
        const stepData = JSON.parse(event.data.data);
        addStep(runResult, stepData, stepSeq, event.data.iteration || 1);
        console.log(`[cli] Step ${stepSeq}: ${stepData.type} ${stepData.name} -> ${stepData.response?.status}`);
        break;
      }

      case "transaction": {
        const txData = JSON.parse(event.data.data);
        addTransaction(runResult, txData);
        console.log(`[cli] Transaction: ${txData.name} ${txData.status} ${txData.durationMs}ms`);
        break;
      }

      case "log": {
        addLog(runResult, {
          ts: event.data.ts,
          level: event.data.level,
          msg: event.data.msg,
          file: event.data.file,
          line: event.data.line,
        });
        const prefix = event.data.level === "error" ? "✗" : event.data.level === "warn" ? "⚠" : "ℹ";
        console.log(`[cli] ${prefix} [${event.data.file}:${event.data.line}] ${event.data.msg}`);
        break;
      }

      case "done":
        console.log(`[cli] Run done: ${event.data.status}`);
        finalizeRun(runResult, event.data.status);
        saveRun(cacheDir, runId, runResult);
        console.log(`[cli] Results saved to ${cacheDir}/runs/${runId}/run.json`);
        stopMockServer().then(() => child.kill());
        process.exit(event.data.status === "passed" ? 0 : 1);
        break;

      case "stopped":
        console.log(`[cli] Stopped: ${event.data.reason}`);
        finalizeRun(runResult, "stopped");
        saveRun(cacheDir, runId, runResult);
        stopMockServer().then(() => child.kill());
        process.exit(0);
        break;

      case "error":
        console.error(`[cli] Runner error: ${event.data.message}`);
        break;
    }
  });

  child.on("error", (err) => {
    console.error(`[cli] Child process error: ${err.message}`);
    stopMockServer();
    process.exit(1);
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[cli] Runner exited with code ${code}`);
    }
  });

  // Timeout safety
  setTimeout(() => {
    console.error(`[cli] Timeout: killing runner`);
    stopMockServer();
    child.kill("SIGKILL");
    process.exit(1);
  }, 120000);
}

// Run
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node server/test/run-cli.js <scriptDir> [iterations]");
  process.exit(1);
}

const scriptDir = args[0];
const iterations = parseInt(args[1] || "1", 10);

runCli(scriptDir, iterations).catch((err) => {
  console.error(`[cli] Fatal: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});