/**
 * CLI test runner — menjalankan compile + runner tanpa UI.
 *
 * Usage: node server/test/run-cli.js <scriptDir> [iterations]
 *
 * Contoh: node server/test/run-cli.js samples/core 3
 *
 * Exit 0 bila run `passed`, selain itu 1. `run.json` sudah tertulis saat exit.
 */

import { resolve } from "node:path";

import { startRun } from "../runs/execute.js";
import { cacheDirFor, resolveScriptDir } from "../project/paths.js";
import { startMockServer, stopMockServer } from "./mock.js";

const LOG_PREFIX = { error: "✗", warn: "⚠" };

/** Cetak satu event run ke konsol */
function printEvent(event) {
  const { type, data } = event;
  switch (type) {
    case "started":
      console.log(`[cli] Run started: ${data.runId}`);
      break;
    case "iterationStart":
      console.log(`[cli] Iteration ${data.iteration} ${data.action} started`);
      break;
    case "iterationEnd":
      console.log(`[cli] Iteration ${data.iteration} ${data.action} ${data.status}`);
      break;
    case "step":
      console.log(`[cli] Step ${data.seq}: ${data.type} ${data.name} -> ${data.response?.status}`);
      break;
    case "transaction":
      console.log(`[cli] Transaction: ${data.name} ${data.status} ${data.durationMs}ms`);
      break;
    case "log":
      console.log(`[cli] ${LOG_PREFIX[data.level] ?? "ℹ"} [${data.file}:${data.line}] ${data.msg}`);
      break;
    case "error":
      console.error(`[cli] Runner error: ${data.message}`);
      break;
  }
}

async function runCli(scriptDirArg, iterations = 1) {
  const scriptDir = resolve(scriptDirArg);
  console.log(`[cli] Script dir: ${scriptDir}`);
  console.log(`[cli] Iterations: ${iterations}`);

  await startMockServer(18081);

  try {
    const run = await startRun({ scriptDir, options: { iterations } });
    for (const w of run.warnings) console.log(`[cli] ⚠ ${w.file}:${w.line} ${w.message}`);
    run.events.on("event", printEvent);

    const result = await run.done;

    const runJson = `${cacheDirFor(await resolveScriptDir(scriptDir))}/runs/${result.runId}/run.json`;
    console.log(`[cli] Run done: ${result.status}`);
    console.log(`[cli] Results saved to ${runJson}`);
    return result.status === "passed" ? 0 : 1;
  } finally {
    await stopMockServer();
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node server/test/run-cli.js <scriptDir> [iterations]");
  process.exit(1);
}

runCli(args[0], parseInt(args[1] || "1", 10))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[cli] Fatal: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
