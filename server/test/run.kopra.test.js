/**
 * Test AC S5: pola Action General KOPRA (fixture sintetis) dijalankan end-to-end ke mock lokal.
 * Mock di port 18084; tidak ada request ke server luar.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { startRun } from "../runs/execute.js";
import { startMockServer, stopMockServer } from "./mock.js";

const KOPRA_DIR = path.resolve("server/test/__fixtures__/kopra-run");

let tmpCache;
let previousCache;

beforeAll(async () => {
  previousCache = process.env.VUGEN_CACHE_DIR;
  tmpCache = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-kopra-test-"));
  process.env.VUGEN_CACHE_DIR = tmpCache;
  await startMockServer(18084);
});

afterAll(async () => {
  await stopMockServer();
  if (previousCache === undefined) delete process.env.VUGEN_CACHE_DIR;
  else process.env.VUGEN_CACHE_DIR = previousCache;
  await fs.rm(tmpCache, { recursive: true, force: true });
});

describe("AC S5: pola KOPRA ke mock (continueOnError)", () => {
  /** @type {import("../runs/store.js").RunResult} */
  let result;

  beforeAll(async () => {
    const run = await startRun({ scriptDir: KOPRA_DIR, options: { iterations: 1, continueOnError: true } });
    result = await run.done;
  }, 30000);

  it("{subTrans} terisi dari web_js_run dan nama step tidak mengandung {…}", () => {
    expect(result.params.subTrans).toBe("DEMO_01");
    const names = result.steps.map((step) => step.name);
    expect(names).toContain("RPS_DEMO_01_01_ui");
    expect(names.some((name) => /[{}]/.test(name))).toBe(false);
  });

  it("timer + compareDuration menghasilkan angka > 0", () => {
    expect(Number(result.params.totalSeq)).toBeGreaterThan(0);
  });

  it("transaksi dengan step 500 berstatus Fail dan lr_get_transaction_status mengembalikan LR_FAIL", () => {
    const byName = Object.fromEntries(result.transactions.map((t) => [t.name, t]));
    expect(byName.T_ECHO.status).toBe("Pass");
    expect(byName.T_FAIL.status).toBe("Fail");
    expect(result.params.failDetected).toBe("ya"); // cabang `== LR_FAIL` dimasuki
    const boom = result.steps.find((step) => step.name === "boom");
    expect(boom).toMatchObject({ transaction: "T_FAIL", error: expect.stringContaining("HTTP 500") });
  });

  it("lr_set_transaction tercatat dengan durasi detik -> ms", () => {
    const total = result.transactions.find((t) => t.name === "DEMO_01_total");
    expect(total).toMatchObject({ status: "Pass", iteration: 1 });
    expect(total.durationMs).toBeGreaterThan(0);
  });

  it("web_add_header hanya ada di request pertama sesudahnya; auto header di semua request", () => {
    const first = result.steps.find((step) => step.name === "echo_first");
    const second = result.steps.find((step) => step.name === "echo_second");
    expect(first.request.headers["x-once"]).toBe("1");
    expect(second.request.headers["x-once"]).toBeUndefined();
    expect(first.request.headers["accept-language"]).toBe("id-ID");
    expect(second.request.headers["accept-language"]).toBe("id-ID");
  });

  it("run selesai passed (kegagalan step dicatat di step, bukan menggagalkan run)", () => {
    expect(result.status).toBe("passed");
  });
});

describe("tanpa continueOnError: step gagal menghentikan iterasi", () => {
  it("run failed, transaksi yang sudah selesai tercatat, transaksi yang terputus tidak", async () => {
    const run = await startRun({ scriptDir: KOPRA_DIR, options: { iterations: 1, continueOnError: false } });
    const result = await run.done;

    expect(result.status).toBe("failed");
    expect(result.steps.at(-1)).toMatchObject({ name: "boom", error: expect.stringContaining("HTTP 500") });
    expect(result.transactions.map((t) => t.name)).toEqual(["T_ECHO"]);
    expect(result.log.some((entry) => entry.level === "warn" && /T_FAIL/.test(entry.msg))).toBe(true);
    expect(result.log.some((entry) => entry.level === "error" && /Iteration 1 Action failed/.test(entry.msg))).toBe(true);
  }, 30000);
});

describe("log http-client memuat file/line konteks step", () => {
  it("tidak ada log dengan file/line kosong untuk baris [http-client]", async () => {
    const run = await startRun({ scriptDir: KOPRA_DIR, options: { iterations: 1, continueOnError: true } });
    const result = await run.done;
    const httpLogs = result.log.filter((entry) => /^\[http-client\]/.test(entry.msg));
    expect(httpLogs.length).toBeGreaterThan(0);
    for (const entry of httpLogs) {
      expect(entry.file, entry.msg).toBeTruthy();
      expect(entry.line, entry.msg).toBeGreaterThan(0);
    }
  }, 30000);
});
