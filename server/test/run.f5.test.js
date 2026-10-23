/**
 * Test integrasi jalur run end-to-end (S2): compile → fork runner → step → run.json.
 *
 * Memakai mock server di port tetap 18081 (URL itu ditulis di samples/).
 * Semua test di file ini berjalan berurutan, cache dialihkan ke folder temp.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { startRun } from "../runs/execute.js";
import { runCacheDirFor, resolveScriptDir } from "../project/paths.js";
import { startMockServer, stopMockServer } from "./mock.js";

const F5_DIR = path.resolve("samples/f5");
const CORE_DIR = path.resolve("samples/core");
const WEB_REQUEST = /\bweb_(?:url|submit_data|submit_form|custom_request|rest)\s*\(/;

let tmpCache;
let previousCache;

beforeAll(async () => {
  previousCache = process.env.VUGEN_CACHE_DIR;
  tmpCache = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-run-test-"));
  process.env.VUGEN_CACHE_DIR = tmpCache;
  await startMockServer(18081);
});

afterAll(async () => {
  await stopMockServer();
  if (previousCache === undefined) delete process.env.VUGEN_CACHE_DIR;
  else process.env.VUGEN_CACHE_DIR = previousCache;
  await fs.rm(tmpCache, { recursive: true, force: true });
});

/** Nomor baris (1-based) pemanggilan `web_*` bernama `name` di sumber C. */
function lineOfCall(source, name) {
  const lines = source.split(/\r?\n/);
  const idx = lines.findIndex((l) => WEB_REQUEST.test(l) && l.includes(`"${name}"`));
  return idx + 1;
}

describe("run samples/f5", () => {
  it("menghasilkan step lengkap, body, params, check, dan transaksi", async () => {
    const source = await fs.readFile(path.join(F5_DIR, "Action.c"), "utf8");
    const expectedRequests = source.split(/\r?\n/).filter((l) => WEB_REQUEST.test(l)).length;

    const run = await startRun({ scriptDir: F5_DIR, options: { iterations: 1 } });
    // saat event "done" diterima, run.json sudah harus ada di disk (tidak ada race)
    const runJsonPath = path.join(runCacheDirFor(await resolveScriptDir(F5_DIR)), "runs", run.runId, "run.json");
    let runJsonExistedOnDone = false;
    run.events.on("event", (event) => {
      if (event.type === "done") runJsonExistedOnDone = existsSync(runJsonPath);
    });

    const result = await run.done;

    expect(runJsonExistedOnDone).toBe(true);
    expect(result.status).toBe("passed");
    expect(result.steps).toHaveLength(expectedRequests);

    // seq berurutan dari 1; file/line sesuai sumber C
    result.steps.forEach((step, i) => expect(step.seq).toBe(i + 1));
    const byName = Object.fromEntries(result.steps.map((s) => [s.name, s]));
    for (const name of ["home", "login", "dashboard", "verify"]) {
      expect(byName[name].file).toMatch(/Action\.c$/);
      expect(byName[name].line).toBe(lineOfCall(source, name));
      expect(byName[name].timing.durationMs).toBeGreaterThanOrEqual(0);
    }

    // request asli
    expect(byName.home.request.method).toBe("GET");
    expect(byName.home.request.url).toBe("http://127.0.0.1:18081/");
    expect(byName.login.request.method).toBe("POST");
    expect(byName.login.request.url).toBe("http://127.0.0.1:18081/login");
    expect(byName.login.request.headers.Cookie ?? byName.login.request.headers.cookie).toMatch(/session_id=/);
    expect(byName.login.response.redirects).toHaveLength(1);

    // correlation: params.csrf terisi dan dipakai di body login
    expect(result.params.csrf).toMatch(/^csrf_/);
    expect(byName.login.request.bodyPreview).toContain(`csrf=${result.params.csrf}`);

    // body tersimpan di steps/<seq>.body
    const runDir = path.join(runCacheDirFor(await resolveScriptDir(F5_DIR)), "runs", result.runId);
    const body1 = await fs.readFile(path.join(runDir, "steps", "1.body"), "utf8");
    expect(body1).toContain("Mock Login Page");
    expect(byName.home.response.bodyFile).toBeTruthy();

    // web_reg_find
    expect(byName.verify.checks).toHaveLength(1);
    expect(byName.verify.checks[0]).toMatchObject({ type: "web_reg_find", passed: true });

    // transaksi + nama transaksi di step
    expect(result.transactions.map((t) => t.name)).toEqual(["T01_home", "T02_dashboard"]);
    expect(byName.home.transaction).toBe("T01_home");

    // run.json tertulis dan konsisten dengan hasil
    const saved = JSON.parse(await fs.readFile(path.join(runDir, "run.json"), "utf8"));
    expect(saved.status).toBe("passed");
    expect(saved.steps).toHaveLength(expectedRequests);

    // event terakhir adalah "done"
    expect(run.history.at(-1).type).toBe("done");
  }, 30000);
});

describe("run samples/core iterations=3", () => {
  it("init & end 1×, Action 3× dengan iteration 1..3", async () => {
    const run = await startRun({ scriptDir: CORE_DIR, options: { iterations: 3 } });
    const result = await run.done;

    expect(result.status).toBe("passed");

    const starts = run.history.filter((e) => e.type === "iterationStart").map((e) => e.data.action);
    expect(starts.filter((a) => a === "vuser_init")).toHaveLength(1);
    expect(starts.filter((a) => a === "vuser_end")).toHaveLength(1);
    expect(starts.filter((a) => a === "Action")).toHaveLength(3);

    const stepsPerIteration = [1, 2, 3].map((n) => result.steps.filter((s) => s.iteration === n).length);
    expect(stepsPerIteration).toEqual([3, 3, 3]);
    expect(result.steps).toHaveLength(9);
  }, 30000);
});
