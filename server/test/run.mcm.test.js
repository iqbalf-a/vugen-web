/**
 * AC akhir F7: fixture sintetis `mcm-like` (meniru POLA script MCM) dijalankan ke mock lokal (port 18088):
 * Basic auth dari lr_param_sprintf + web_convert_from_formatted, token dari web_reg_save_param_json,
 * blok web_concurrent_*, auto header di-revert/remove, cek transaksi + lr_exit.
 * Tidak ada request ke server target asli.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { compileScript } from "../compiler/transpile.js";
import { loadProject } from "../project/loader.js";
import { startRun } from "../runs/execute.js";
import { startMockServer, stopMockServer } from "./mock.js";

const MCM_DIR = path.resolve("server/test/__fixtures__/mcm-like");

let tmpCache;
let previousCache;

beforeAll(async () => {
  previousCache = process.env.VUGEN_CACHE_DIR;
  tmpCache = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-mcm-test-"));
  process.env.VUGEN_CACHE_DIR = tmpCache;
  await startMockServer(18088);
});

afterAll(async () => {
  await stopMockServer();
  if (previousCache === undefined) delete process.env.VUGEN_CACHE_DIR;
  else process.env.VUGEN_CACHE_DIR = previousCache;
  await fs.rm(tmpCache, { recursive: true, force: true });
});

describe("mcm-like: compile", () => {
  it("ter-compile tanpa warning (semua fungsi dikenal)", async () => {
    const project = await loadProject(MCM_DIR);
    const result = await compileScript({ scriptDir: MCM_DIR, cacheDir: path.join(tmpCache, "compile"), files: project.files });
    expect(result.warnings).toEqual([]);
  });
});

describe("mcm-like: run ke mock (iterations=2, continueOnError)", () => {
  /** @type {import("../runs/store.js").RunResult} */
  let result;
  let run;

  beforeAll(async () => {
    run = await startRun({ scriptDir: MCM_DIR, options: { iterations: 2, continueOnError: true } });
    result = await run.done;
  }, 30000);

  const step = (name, iteration = 1) => result.steps.find((s) => s.name === name && s.iteration === iteration);

  it("Basic auth: Authorization = Basic base64(username:password) dari lr_param_sprintf + web_convert_from_formatted", () => {
    const expected = `Basic ${Buffer.from("demo:secret").toString("base64")}`;
    expect(result.params.usernamePassword).toBe("demo:secret");
    expect(step("signin").request.headers.authorization).toBe(expected);
    // header sekali pakai: tidak ikut ke request berikutnya
    expect(step("echo_1").request.headers.authorization).toBeUndefined();
  });

  it("token dari web_reg_save_param_json dipakai di request berikutnya", () => {
    expect(result.params).toMatchObject({ token: "tok-123", kopraId: "K-9" });
    expect(step("echo_1").request.headers["x-token"]).toBe("tok-123");
    expect(step("echo_2").request.headers["x-token"]).toBe("tok-123");
  });

  it("blok web_concurrent_*: request dijalankan berurutan sebagai step normal", () => {
    const names = result.steps.filter((s) => s.iteration === 1).map((s) => s.name);
    expect(names).toEqual(["signin", "echo_1", "echo_2", "logout_check", "logout_flaky"]);
    expect(step("echo_2").timing.startMs).toBeGreaterThanOrEqual(step("echo_1").timing.startMs);
  });

  it("auto header di-revert / di-remove: hilang dari request sesudahnya, header lain tetap", () => {
    const headers = step("logout_check").request.headers;
    expect(headers["device-id"]).toBeUndefined(); // web_revert_auto_header
    expect(headers["x-token"]).toBeUndefined(); // web_remove_auto_header (ImplicitGen= diabaikan)
    expect(headers["accept-language"]).toBe("id-ID"); // tidak disentuh
    expect(step("echo_1").request.headers["device-id"]).toBe("dev-001"); // masih ada sebelum revert
    expect(result.log.some((entry) => entry.level === "warn" && /ImplicitGen/.test(entry.msg))).toBe(true);
  });

  it("cek transaksi + lr_exit: iterasi 1 (logout 500) berhenti di lr_exit; iterasi 2 selesai normal", () => {
    expect(result.transactions.map((t) => [t.iteration, t.name, t.status])).toEqual([
      [1, "DEMO_02_exc", "Pass"],
      [1, "DEMO_03_exc", "Fail"],
      [2, "DEMO_02_exc", "Pass"],
      [2, "DEMO_03_exc", "Pass"],
    ]);

    const iterations = run.history.filter((e) => e.type === "iterationEnd").map((e) => [e.data.action, e.data.iteration, e.data.status]);
    expect(iterations).toEqual([
      ["vuser_init", 1, "passed"],
      ["Action", 1, "failed"],
      ["Action", 2, "passed"],
      ["vuser_end", 1, "passed"],
    ]);

    const messages = result.log.map((entry) => entry.msg);
    expect(messages.filter((msg) => msg === "action-selesai")).toHaveLength(1); // hanya iterasi 2
    expect(messages.filter((msg) => msg === "logout-selesai")).toHaveLength(1);
    expect(messages).toContain("lr_exit: LR_EXIT_ITERATION_AND_CONTINUE LR_FAIL");
    expect(result.status).toBe("failed");
  });
});
