/**
 * runner.js — Entry point child process (fork).
 *
 * Dijalankan oleh parent (server/routes/run.js) lewat `child_process.fork`.
 * Menerima pesan `{ type: "start", payload }`, menjalankan script, mengirim
 * event via `process.send({ type: "event", event })`, dan keluar.
 *
 * Plan §7.3: hasil run disimpan ke cache oleh parent; runner hanya kirim event.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { HttpClient } from "./http-client.js";
import { computeTimeValue } from "../project/parameters.js";
import { TrackedParams } from "./tracked-params.js";
import * as vuserApi from "./vuser-api.js";

// Bind vuser-api ke runner context
const vu = {
  http: null,
  params: new TrackedParams(() => ({ file: vu.currentFile, line: vu.currentLine })), // setiap perubahan dicatat (untuk panel Parameter)
  transactions: new Map(),        // transaksi terbuka: nama -> { startMs, failed }
  transactionResults: new Map(),  // hasil transaksi yang sudah selesai: nama -> Pass|Fail
  currentFile: "",
  currentLine: 0,
  currentIteration: 1,  // Track current iteration
  runOptions: {},
  seq: 0,            // counter step, runner yang memberi nomor
  stepFailures: 0,   // jumlah step gagal sejauh ini (untuk lr_exit LR_AUTO)
  exitRequest: null, // permintaan lr_exit(VUSER_AFTER_*): { mode, status }
  currentVars: null, // getter variabel C pada baris saat ini
  runStartMs: 0,     // epoch ms awal run (untuk timing.startMs)
  cacheDir: "",
  runId: "",
  breakpoints: [],     // [{file, line}] — passed from run options
  pauseResolve: null,  // resolve fn for current breakpoint pause; null when not paused
  scriptDir: "",
  unmaskMap: null,   // pemetaan override dari lr_unmask.json (null = belum dicoba, {} = tidak ada file)
  _lineAtThrottle: { file: "", line: 0, ts: 0 }, // throttle state untuk lineAt
  log: (level, msg) => {
    sendEvent("log", { level, msg, file: vu.currentFile, line: vu.currentLine, iteration: vu.currentIteration });
  },
  sendEvent,
  __at: (file, line, vars) => {
    vu.currentFile = file;
    vu.currentLine = line;
    vu.currentVars = typeof vars === "function" ? vars : null;
    // Throttle lineAt: kirim hanya bila file berubah atau sudah >80ms sejak kiriman terakhir
    const t = vu._lineAtThrottle;
    const now = Date.now();
    if (file !== t.file || now - t.ts >= 80) {
      t.file = file; t.line = line; t.ts = now;
      sendEvent("lineAt", { file, line });
    }
    // Hanya return Promise saat ada breakpoint — hindari overhead async tiap baris
    if (vu.breakpoints.length) return pauseAtBreakpoint(file, line);
  },
  __unsupported: (raw, file, line) => {
    vu.log("warn", `Unsupported: ${raw} at ${file}:${line}`);
    return Promise.resolve(0);
  },
  __unsupportedCall: (name, file, line) => {
    vu.log("warn", `Unsupported call: ${name} at ${file}:${line}`);
    return Promise.resolve(0);
  },
};

// Attach all vuser-api functions to vu object
const runnerAt = vu.__at;
Object.assign(vu, vuserApi);
vu.__at = runnerAt; // vuser-api punya __at polos; versi runner yang memancarkan lineAt + breakpoint

vuserApi.__bind(vu);
vu.pauseAtBreakpoint = pauseAtBreakpoint;

/** Kirim event ke parent process */
function sendEvent(type, data, callback) {
  process.send({ type: "event", event: { type, data, ts: Date.now() } }, callback);
}

/**
 * Siapkan file parameter (.dat): urut per iterasi, nilai baris pertama langsung tersedia.
 * `parameters` berupa array [{ name, file, values, selectNextRow?, updateValueOn?, outOfRangePolicy? }].
 */
function initParameterFiles(parameters) {
  vu.parameterFiles = new Map();
  for (const { name, file, values, selectNextRow = "Sequential", sameLineAs = null, updateValueOn = "EachIteration", outOfRangePolicy = "Cycle", type, timeFormat, timeOffsetSec } of parameters ?? []) {
    vu.parameterFiles.set(name, {
      values,
      currentIndex: 0,
      file,
      selectNextRow,
      sameLineAs,
      updateValueOn,
      outOfRangePolicy,
      usedIndices: selectNextRow === "Unique" ? new Set([0]) : null,
      type: type || "Table",
      timeFormat: timeFormat || null,
      timeOffsetSec: timeOffsetSec ?? 0,
    });
    if (values.length > 0) vu.params.set(name, values[0], type === "Time" ? `Time: ${timeFormat}` : `.dat: ${file}`);
  }
}

/**
 * Iterasi berikutnya: pilih baris sesuai strategi SelectNextRow dan OutOfRangePolicy dari .prm.
 * Melempar Error bila OutOfRangePolicy="Abort" dan nilai habis.
 */
function advanceParameterFiles() {
  for (const [name, param] of vu.parameterFiles) {
    // Type=Time: recompute dari waktu saat ini + offset
    if (param.type === "Time") {
      if (param.updateValueOn !== "Once" && param.timeFormat) {
        vu.params.set(name, computeTimeValue(param.timeFormat, param.timeOffsetSec), `Time: ${param.timeFormat}`);
      }
      continue;
    }
    if (param.selectNextRow === "SameLine") continue; // mengikuti induk, lihat di bawah
    if (param.updateValueOn === "Once") continue; // nilai tetap, tidak pernah maju

    const n = param.values.length;
    if (n === 0) continue;

    let nextIndex;

    if (param.selectNextRow === "Random") {
      nextIndex = Math.floor(Math.random() * n);
    } else if (param.selectNextRow === "Unique") {
      let found = false;
      for (let i = 1; i <= n; i++) {
        const candidate = (param.currentIndex + i) % n;
        if (!param.usedIndices.has(candidate)) {
          nextIndex = candidate;
          param.usedIndices.add(candidate);
          found = true;
          break;
        }
      }
      if (!found) {
        // Semua nilai sudah dipakai
        switch (param.outOfRangePolicy) {
          case "Continue":
            continue; // tetap di nilai terakhir
          case "Abort":
            throw new Error(`Parameter "${name}" kehabisan nilai unik (${n} baris, OutOfRangePolicy=Abort)`);
          default: // Cycle
            param.usedIndices.clear();
            nextIndex = 0;
            param.usedIndices.add(0);
        }
      }
    } else {
      // Sequential (default)
      if (param.currentIndex < n - 1) {
        nextIndex = param.currentIndex + 1;
      } else {
        switch (param.outOfRangePolicy) {
          case "Continue":
            continue; // tetap di nilai terakhir
          case "Abort":
            throw new Error(`Parameter "${name}" kehabisan nilai (${n} baris, OutOfRangePolicy=Abort)`);
          default: // Cycle
            nextIndex = 0;
        }
      }
    }

    param.currentIndex = nextIndex;
    vu.params.set(name, param.values[nextIndex], `.dat: ${param.file}`);
  }

  // "Same line as X": baris selalu sama dengan induk; Update value on dan When out of values milik induk.
  for (const [name, param] of vu.parameterFiles) {
    if (param.selectNextRow !== "SameLine") continue;
    const parent = vu.parameterFiles.get(param.sameLineAs);
    if (!parent || param.values.length === 0) continue;
    const index = Math.min(parent.currentIndex, param.values.length - 1);
    if (index === param.currentIndex) continue;
    param.currentIndex = index;
    vu.params.set(name, param.values[index], `.dat: ${param.file}`);
  }
}

/** Pause execution if a breakpoint matches. Resolves when parent sends "resume". */
async function pauseAtBreakpoint(file, line) {
  if (!vu.breakpoints.length || !line) return;
  const fileBase = (file || "").split(/[\\/]/).pop().toLowerCase();
  const hit = vu.breakpoints.find((bp) => {
    const bpBase = (bp.file || "").split(/[\\/]/).pop().toLowerCase();
    return (bp.file === file || bpBase === fileBase) && Number(bp.line) === line;
  });
  if (!hit) return;
  await new Promise((resolve) => {
    vu.pauseResolve = resolve;
    sendEvent("paused", { file, line, seq: vu.seq + 1 });
  });
  vu.pauseResolve = null;
}

/** Main run logic */
async function run(payload) {

  try {
    const { modulePath, options, runId, cacheDir, parameters, scriptDir } = payload;

    vu.runId = runId;
    vu.cacheDir = cacheDir;
    vu.scriptDir = scriptDir || "";
    vu.seq = 0;
    vu.runStartMs = Date.now();

    // Muat lr_unmask.json jika ada (pemetaan override masked → plaintext)
    try {
      const mapText = await fs.readFile(path.join(vu.scriptDir, "lr_unmask.json"), "utf8");
      vu.unmaskMap = JSON.parse(mapText);
    } catch {
      vu.unmaskMap = {};
    }

    vu.runOptions = {
      thinkTime: options.thinkTime || "ignore",
      insecureTLS: options.insecureTLS || false,
      timeoutMs: options.timeoutMs || 60000,
      continueOnError: options.continueOnError || false,
      iterationDelayMs: options.iterationDelayMs || 0,
      newUserEachIteration: options.newUserEachIteration !== false,
    };
    vu.breakpoints = Array.isArray(options.breakpoints) ? options.breakpoints : [];

    initParameterFiles(parameters);

    // Initialize HTTP client
    vu.http = new HttpClient({
      timeoutMs: vu.runOptions.timeoutMs,
      insecureTLS: vu.runOptions.insecureTLS,
      followRedirects: true,
      maxRedirects: 10,
      debugCallback: (level, msg) => vu.log(level, msg), // sertakan file/line/iterasi dari konteks step
    });

    // Import transpiled module
    const moduleUrl = `${pathToFileURL(modulePath).href}?t=${Date.now()}`;
    let mod;
    try {
      mod = await import(moduleUrl);
    } catch (error) {
      sendEvent("error", { message: `Failed to load transpiled module: ${error.message}` });
      process.exit(1);
    }

    // Bind vuser-api to module
    mod.__bind(vu);

    // Use __entries from module (generated by transpiler)
    // __entries maps action names to FUNCTIONS directly
    const entries = mod.__entries || {};
    // __entries berkunci basename file .c ("Action", "vuser_init"); Run Logic dari loader
    // berisi nama file ("vuser_init.c") atau { name, file } — cocokkan lewat basename file.
    const entryKey = (ref) => {
      const raw = typeof ref === "string" ? ref : (ref?.file || ref?.name || "");
      return raw.split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
    };
    const resolveFn = (ref) => {
      const key = entryKey(ref);
      const found = Object.keys(entries).find((name) => name === key) ?? Object.keys(entries).find((name) => name.toLowerCase() === key.toLowerCase());
      return found && typeof entries[found] === "function" ? { name: found, fn: entries[found] } : null;
    };

    // Run order dari Run Logic: vuser_init -> semua actions (berurutan) -> vuser_end
    const runLogic = payload.runLogic || { init: "vuser_init", actions: ["Action"], end: "vuser_end" };
    const initFn = runLogic.init && resolveFn(runLogic.init);
    const actionFns = (runLogic.actions?.length > 0 ? runLogic.actions : ["Action"]).map(resolveFn).filter(Boolean);
    const endFn = runLogic.end && resolveFn(runLogic.end);
    const iterations = options.iterations || 1;

    sendEvent("started", { runId, actions: [initFn, ...actionFns, endFn].filter(Boolean).map((unit) => unit.name) });

    /**
     * Jalankan satu unit (vuser_init, satu iterasi action, vuser_end).
     * - Error biasa = unit gagal: transaksi terbuka dicatat Fail, pemanggil lanjut (perilaku VuGen).
     * - lr_exit = akhir normal unit; status dari argumen lr_exit (LR_AUTO: gagal bila ada step gagal).
     * @returns {Promise<{ failed: boolean, stopAll: boolean }>} stopAll: tidak ada iterasi baru lagi
     */
    const runUnit = async (unit, iteration) => {
      // Konteks iterasi dulu, supaya log/step/transaksi memakai nomor yang benar
      vu.currentIteration = iteration;
      vu.transactions.clear();
      vu.exitRequest = null;
      const failuresBefore = vu.stepFailures;
      sendEvent("iterationStart", { iteration, action: unit.name });

      let failed = false;
      let errorMessage = null;
      let exit = null;
      let errorThrown = false;
      try {
        await unit.fn();
      } catch (error) {
        if (error instanceof vuserApi.__VuserExit) {
          exit = { mode: error.mode, status: error.status };
          vuserApi.__endOpenTransactionsOnExit(error.status);
        } else {
          failed = true;
          errorThrown = true;
          errorMessage = error.message;
          vu.log("error", `Iteration ${iteration} ${unit.name} failed: ${error.message}`);
          vuserApi.__failOpenTransactions();
        }
      }
      exit ??= vu.exitRequest; // lr_exit(VUSER_AFTER_*) tidak melempar
      if (exit) failed = exit.status === 1 || (exit.status === 2 && vu.stepFailures > failuresBefore);

      sendEvent("iterationEnd", {
        iteration,
        action: unit.name,
        status: failed ? "failed" : "passed",
        ...(errorMessage ? { error: errorMessage } : {}),
      });
      // stopActions: stop remaining actions in this iteration (unhandled error)
      // stopAll: stop all iterations (lr_exit with VUSER_ABORT / VUSER_END modes)
      return {
        failed,
        stopActions: errorThrown,
        stopAll: Boolean(exit && (exit.mode === 0 || exit.mode >= 3)),
      };
    };

    // Status run = failed bila ada unit yang gagal. Stop dari user menghentikan proses ini (lihat handler "stop").
    let anyFailed = false;
    let stopIterations = false;

    // vuser_init gagal / lr_exit(VUSER): tidak ada iterasi, tetapi vuser_end tetap dijalankan
    if (initFn) {
      const result = await runUnit(initFn, 1);
      anyFailed ||= result.failed;
      stopIterations = result.failed || result.stopAll;
    }

    if (!stopIterations && actionFns.length > 0) {
      for (let iter = 1; iter <= iterations; iter++) {
        // New user each iteration: clear cookies; header sekali pakai dibuang, auto header tetap.
        // lr_save_string params persist across iterations per plan §6.
        if (vu.runOptions.newUserEachIteration && iter > 1) {
          vu.http.clearCookies();
          vuserApi.__resetHeaders();
        }
        if (iter > 1) {
          try {
            advanceParameterFiles();
          } catch (error) {
            vu.log("error", error.message);
            anyFailed = true;
            break;
          }
        }

        // Jalankan setiap action dalam urutan Run Logic
        let stopRun = false;
        for (const actionFn of actionFns) {
          const result = await runUnit(actionFn, iter);
          anyFailed ||= result.failed;
          if (result.stopAll) { stopRun = true; break; }
          if (result.stopActions) break; // error: skip remaining actions, continue iterations
        }
        if (stopRun) break;

        // Delay between iterations
        if (iter < iterations && vu.runOptions.iterationDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, vu.runOptions.iterationDelayMs));
        }
      }
    }

    // vuser_end selalu dijalankan sekali di akhir
    if (endFn) {
      const result = await runUnit(endFn, 1); // dijalankan walau iterasi sebelumnya gagal (jangan di dalam ||=)
      anyFailed ||= result.failed;
    }

    // Send done BEFORE cleanup so parent gets it even if close hangs
    sendEvent("done", { runId, status: anyFailed ? "failed" : "passed", params: Object.fromEntries(vu.params) });

    // Cleanup (fire-and-forget with timeout)
    vu.http.close().catch((err) => {
      sendEvent("log", { level: "debug", msg: `[runner] http.close warning: ${err.message}` });
    });
    // Give time for done event to flush
    await new Promise(r => setTimeout(r, 100));
  } catch (error) {
    sendEvent("error", { message: `Runner fatal error: ${error.message}` });
    process.exit(1);
  }
}

// Handle messages from parent
process.on("message", (msg) => {
  if (msg?.type === "start") {
    run(msg.payload).catch((error) => {
      sendEvent("error", { message: `Runner fatal error: ${error.message}` });
      process.exit(1);
    });
  } else if (msg?.type === "stop") {
    // Keluar setelah event terkirim supaya parent tahu ini stop yang disengaja
    sendEvent("stopped", { reason: "Received stop signal" }, () => process.exit(0));
  } else if (msg?.type === "resume") {
    if (vu.pauseResolve) vu.pauseResolve();
  }
});

// Handle uncaught errors
process.on("unhandledRejection", (reason) => {
  sendEvent("error", { message: `Unhandled rejection: ${reason}` });
});

process.on("uncaughtException", (error) => {
  sendEvent("error", { message: `Uncaught exception: ${error.message}` });
  process.exit(1);
});

// Notify parent ready
sendEvent("ready", {});