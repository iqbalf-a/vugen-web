/**
 * Test F7a: lr_exit — unit (fungsi) + integrasi run ke mock lokal (port 18086).
 * Script uji dibuat di folder temp supaya tiap kasus punya Action.c sendiri.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { startRun } from "../runs/execute.js";
import * as api from "../runtime/vuser-api.js";
import { startMockServer, stopMockServer } from "./mock.js";

let base;
let previousCache;

beforeAll(async () => {
  previousCache = process.env.VUGEN_CACHE_DIR;
  base = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-exit-"));
  process.env.VUGEN_CACHE_DIR = path.join(base, "cache");
  await startMockServer(18086);
});

afterAll(async () => {
  await stopMockServer();
  if (previousCache === undefined) delete process.env.VUGEN_CACHE_DIR;
  else process.env.VUGEN_CACHE_DIR = previousCache;
  await fs.rm(base, { recursive: true, force: true });
});

let counter = 0;
/** Buat folder script sintetis dengan Action.c dari `body` (vuser_init/vuser_end mencatat log). */
async function makeScript(actionBody, { initBody = 'lr_output_message("init");', endBody = 'lr_output_message("end");' } = {}) {
  const dir = path.join(base, `script-${++counter}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "Action.c"), `Action()\r\n{\r\n${actionBody}\r\n    return 0;\r\n}\r\n`, "utf8");
  await fs.writeFile(path.join(dir, "vuser_init.c"), `vuser_init()\r\n{\r\n    ${initBody}\r\n    return 0;\r\n}\r\n`, "utf8");
  await fs.writeFile(path.join(dir, "vuser_end.c"), `vuser_end()\r\n{\r\n    ${endBody}\r\n    return 0;\r\n}\r\n`, "utf8");
  return dir;
}

const messages = (result) => result.log.map((entry) => entry.msg);
const ends = (run) => run.history.filter((e) => e.type === "iterationEnd").map((e) => [e.data.action, e.data.iteration, e.data.status]);

describe("lr_exit (unit)", () => {
  let logs;
  beforeEach(() => {
    logs = [];
    api.__bind({
      params: new Map(),
      transactions: new Map(),
      transactionResults: new Map(),
      currentIteration: 1,
      stepFailures: 0,
      log: (level, msg) => logs.push([level, msg]),
      sendEvent: () => {},
      runOptions: {},
    });
  });

  it("mode ITERATION_AND_CONTINUE melempar sinyal VuserExit (bukan Error biasa) dan mencatat log info", () => {
    let caught;
    try {
      api.lr_exit(2, 1);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(api.__VuserExit);
    expect(caught).not.toBeInstanceOf(Error);
    expect(caught).toMatchObject({ mode: 2, status: 1 });
    expect(logs).toContainEqual(["info", "lr_exit: LR_EXIT_ITERATION_AND_CONTINUE LR_FAIL"]);
  });

  it("menerima nama string lama untuk mode dan status", () => {
    expect(() => api.lr_exit("LR_EXIT_VUSER", "LR_PASS")).toThrowError(expect.objectContaining({ mode: 0, status: 0 }));
    expect(() => api.lr_exit("LR_EXIT_ACTION_AND_CONTINUE", "LR_AUTO")).toThrowError(expect.objectContaining({ mode: 1, status: 2 }));
  });

  it("status default LR_AUTO", () => {
    expect(() => api.lr_exit(2)).toThrowError(expect.objectContaining({ status: 2 }));
  });

  it("mode VUSER_AFTER_ITERATION / VUSER_AFTER_ACTION tidak melempar: hanya meminta berhenti sesudah iterasi", () => {
    const ctx = { exitRequest: null, log: () => {}, transactions: new Map(), transactionResults: new Map(), sendEvent: () => {}, runOptions: {} };
    api.__bind(ctx);
    expect(api.lr_exit(3, 0)).toBe(0);
    expect(ctx.exitRequest).toEqual({ mode: 3, status: 0 });
    expect(api.lr_exit("LR_EXIT_VUSER_AFTER_ACTION", "LR_FAIL")).toBe(0);
    expect(ctx.exitRequest).toEqual({ mode: 4, status: 1 });
  });

  it("mode tidak dikenal -> error biasa (bukan sinyal exit)", () => {
    expect(() => api.lr_exit(99, 1)).toThrow(/mode/);
  });
});

describe("lr_exit (integrasi ke mock)", () => {
  it("ITERATION_AND_CONTINUE + LR_FAIL di iterasi 1: sisa kode dilewati, iterasi 2-3 jalan, vuser_end 1x, run failed", async () => {
    // /flaky: hit pertama 500 -> transaksi gagal -> lr_exit; hit berikutnya 200
    const dir = await makeScript(`
    lr_start_transaction("T_FLAKY");
    web_url("flaky", "URL=http://127.0.0.1:18086/flaky", LAST);
    lr_end_transaction("T_FLAKY", LR_AUTO);
    if (lr_get_transaction_status("T_FLAKY") == LR_FAIL) {
        lr_exit(LR_EXIT_ITERATION_AND_CONTINUE, LR_FAIL);
    }
    lr_output_message("sesudah-exit");`);

    const run = await startRun({ scriptDir: dir, options: { iterations: 3, continueOnError: true } });
    const result = await run.done;

    expect(ends(run)).toEqual([
      ["vuser_init", 1, "passed"],
      ["Action", 1, "failed"],
      ["Action", 2, "passed"],
      ["Action", 3, "passed"],
      ["vuser_end", 1, "passed"],
    ]);
    expect(result.status).toBe("failed");
    // "sesudah-exit" hanya tercetak di iterasi 2 dan 3
    expect(messages(result).filter((msg) => msg === "sesudah-exit")).toHaveLength(2);
    expect(messages(result).filter((msg) => msg === "end")).toHaveLength(1);
    expect(messages(result)).toContain("lr_exit: LR_EXIT_ITERATION_AND_CONTINUE LR_FAIL");
    expect(result.transactions.map((t) => [t.iteration, t.status])).toEqual([[1, "Fail"], [2, "Pass"], [3, "Pass"]]);
  }, 30000);

  it("LR_EXIT_VUSER + LR_PASS di iterasi 1: iterasi 2-3 tidak jalan, vuser_end jalan, run passed", async () => {
    const dir = await makeScript(`
    lr_output_message("mulai");
    lr_exit(LR_EXIT_VUSER, LR_PASS);
    lr_output_message("tidak-boleh");`);

    const run = await startRun({ scriptDir: dir, options: { iterations: 3 } });
    const result = await run.done;

    expect(ends(run)).toEqual([
      ["vuser_init", 1, "passed"],
      ["Action", 1, "passed"],
      ["vuser_end", 1, "passed"],
    ]);
    expect(result.status).toBe("passed");
    expect(messages(result)).not.toContain("tidak-boleh");
    expect(messages(result).filter((msg) => msg === "mulai")).toHaveLength(1);
    expect(messages(result)).toContain("end");
  }, 30000);

  it("LR_EXIT_VUSER_AFTER_ITERATION: iterasi berjalan sampai selesai, lalu tidak ada iterasi baru; vuser_end jalan", async () => {
    const dir = await makeScript(`
    lr_exit(LR_EXIT_VUSER_AFTER_ITERATION, LR_PASS);
    lr_output_message("masih-jalan");`);

    const run = await startRun({ scriptDir: dir, options: { iterations: 3 } });
    const result = await run.done;

    expect(ends(run).filter(([action]) => action === "Action")).toEqual([["Action", 1, "passed"]]);
    expect(messages(result).filter((msg) => msg === "masih-jalan")).toHaveLength(1);
    expect(messages(result)).toContain("end");
    expect(result.status).toBe("passed");
  }, 30000);

  it("LR_EXIT_VUSER_AFTER_ACTION + LR_FAIL: iterasi dianggap gagal, tidak ada iterasi baru", async () => {
    const dir = await makeScript('    lr_exit(LR_EXIT_VUSER_AFTER_ACTION, LR_FAIL);');
    const run = await startRun({ scriptDir: dir, options: { iterations: 3 } });
    const result = await run.done;
    expect(ends(run).filter(([action]) => action === "Action")).toEqual([["Action", 1, "failed"]]);
    expect(result.status).toBe("failed");
  }, 30000);

  it("LR_AUTO: gagal bila ada step gagal di iterasi itu, selain itu passed", async () => {
    const dir = await makeScript(`
    web_url("rusak", "URL=http://127.0.0.1:18086/status/500", LAST);
    lr_exit(LR_EXIT_ITERATION_AND_CONTINUE, LR_AUTO);`);
    const run = await startRun({ scriptDir: dir, options: { iterations: 1, continueOnError: true } });
    await run.done;
    expect(ends(run)).toContainEqual(["Action", 1, "failed"]);

    const okDir = await makeScript('    lr_exit(LR_EXIT_ITERATION_AND_CONTINUE, LR_AUTO);');
    const okRun = await startRun({ scriptDir: okDir, options: { iterations: 1 } });
    const okResult = await okRun.done;
    expect(ends(okRun)).toContainEqual(["Action", 1, "passed"]);
    expect(okResult.status).toBe("passed");
  }, 30000);

  it("transaksi terbuka saat lr_exit: LR_FAIL -> Fail; LR_PASS -> otomatis per transaksi (Pass bila tanpa step gagal)", async () => {
    const failDir = await makeScript(`
    lr_start_transaction("T_TERBUKA");
    lr_exit(LR_EXIT_ITERATION_AND_CONTINUE, LR_FAIL);`);
    const failResult = await (await startRun({ scriptDir: failDir, options: { iterations: 1 } })).done;
    expect(failResult.transactions.map((t) => [t.name, t.status])).toEqual([["T_TERBUKA", "Fail"]]);

    const passDir = await makeScript(`
    lr_start_transaction("T_TERBUKA");
    lr_exit(LR_EXIT_ITERATION_AND_CONTINUE, LR_PASS);`);
    const passResult = await (await startRun({ scriptDir: passDir, options: { iterations: 1 } })).done;
    expect(passResult.transactions.map((t) => [t.name, t.status])).toEqual([["T_TERBUKA", "Pass"]]);
  }, 30000);

  it("lr_exit di fungsi bersarang (pola KOPRA: Action memanggil fungsi General) menghentikan seluruh iterasi", async () => {
    const dir = await makeScript('    Keluar();\r\n    lr_output_message("tidak-boleh");');
    await fs.writeFile(path.join(dir, "Keluar.c"), 'Keluar()\r\n{\r\n    lr_exit(LR_EXIT_ITERATION_AND_CONTINUE, LR_FAIL);\r\n    return 0;\r\n}\r\n', "utf8");
    const run = await startRun({ scriptDir: dir, options: { iterations: 2 } });
    const result = await run.done;
    expect(messages(result)).not.toContain("tidak-boleh");
    expect(ends(run).filter(([action]) => action === "Action")).toEqual([["Action", 1, "failed"], ["Action", 2, "failed"]]);
  }, 30000);
});
