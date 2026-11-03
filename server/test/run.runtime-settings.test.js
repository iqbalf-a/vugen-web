/**
 * Runtime Settings dari default.cfg [WEB] dipakai run: HttpErrorsAsWarnings & PageDownloadTimeout.
 * Mock di port 18085; tidak ada request ke server luar.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { startRun } from "../runs/execute.js";
import { startMockServer, stopMockServer } from "./mock.js";

const BASE = "http://127.0.0.1:18085";
let tmp;
let previousCache;

async function makeScript(name, cfg, actionBody) {
  const dir = path.join(tmp, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "Action.c"), `Action()\n{\n${actionBody}\n\treturn 0;\n}\n`);
  await fs.writeFile(path.join(dir, "vuser_init.c"), "vuser_init()\n{\n\treturn 0;\n}\n");
  await fs.writeFile(path.join(dir, "vuser_end.c"), "vuser_end()\n{\n\treturn 0;\n}\n");
  if (cfg) await fs.writeFile(path.join(dir, "default.cfg"), cfg);
  return dir;
}

beforeAll(async () => {
  previousCache = process.env.VUGEN_CACHE_DIR;
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-rts-run-"));
  process.env.VUGEN_CACHE_DIR = path.join(tmp, ".cache");
  await startMockServer(18085);
});

afterAll(async () => {
  await stopMockServer();
  if (previousCache === undefined) delete process.env.VUGEN_CACHE_DIR;
  else process.env.VUGEN_CACHE_DIR = previousCache;
  await fs.rm(tmp, { recursive: true, force: true });
});

const HTTP500 = `\tweb_url("e500", "URL=${BASE}/status/500", LAST);\n\tlr_save_string("lanjut", "after");`;

describe("default.cfg [WEB] HttpErrorsAsWarnings", () => {
  it("=0: HTTP 500 menggagalkan step (run failed)", async () => {
    const dir = await makeScript("off", "[WEB]\r\nHttpErrorsAsWarnings=0\r\n", HTTP500);
    const result = await (await startRun({ scriptDir: dir, options: { iterations: 1 } })).done;
    expect(result.status).toBe("failed");
    expect(result.params.after).toBeUndefined();
  }, 30000);

  it("=1: HTTP 500 hanya warning, script lanjut dan run passed", async () => {
    const dir = await makeScript("on", "[WEB]\r\nHttpErrorsAsWarnings=1\r\n", HTTP500);
    const result = await (await startRun({ scriptDir: dir, options: { iterations: 1 } })).done;
    expect(result.status).toBe("passed");
    expect(result.params.after).toBe("lanjut");
    expect(result.steps.find((s) => s.name === "e500")).toMatchObject({ error: null });
    expect(result.log.some((l) => l.level === "warn" && /HTTP 500/.test(l.msg))).toBe(true);
  }, 30000);

  it("web_set_rts_key di script menimpa nilai default.cfg", async () => {
    const body = `\tweb_set_rts_key("key=HttpErrorsAsWarnings", "Value=1", LAST);\n${HTTP500}`;
    const dir = await makeScript("override", "[WEB]\r\nHttpErrorsAsWarnings=0\r\n", body);
    const result = await (await startRun({ scriptDir: dir, options: { iterations: 1 } })).done;
    expect(result.status).toBe("passed");
    expect(result.params.after).toBe("lanjut");
  }, 30000);
});

describe("default.cfg [WEB] PageDownloadTimeout", () => {
  it("=1 detik: request /slow (10 dtk) dibatalkan karena timeout", async () => {
    const dir = await makeScript("timeout", "[WEB]\r\nPageDownloadTimeout=1\r\n", `\tweb_url("lambat", "URL=${BASE}/slow", LAST);`);
    const started = Date.now();
    const result = await (await startRun({ scriptDir: dir, options: { iterations: 1 } })).done;
    expect(Date.now() - started).toBeLessThan(8000);
    expect(result.status).toBe("failed");
  }, 30000);
});
