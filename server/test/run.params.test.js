/**
 * Test S6: parameter dari .dat dipakai runner tanpa lr_save_string, dan /api/project
 * mengembalikan parameters sebagai array biasa (tanpa nilai). Mock di port 18085.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import { apiRouter } from "../routes/index.js";
import { startRun } from "../runs/execute.js";
import { startMockServer, stopMockServer } from "./mock.js";

let base;
let scriptDir;
let previousCache;

beforeAll(async () => {
  previousCache = process.env.VUGEN_CACHE_DIR;
  base = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-params-run-"));
  process.env.VUGEN_CACHE_DIR = path.join(base, "cache");
  scriptDir = path.join(base, "script");
  await fs.mkdir(scriptDir, { recursive: true });

  // header beda kapitalisasi dari nama file; multi-kolom sebaris; CRLF; baris kosong di akhir
  await fs.writeFile(path.join(scriptDir, "hosts.dat"), "Host,pathSuffix\r\n127.0.0.1:18085,one\r\nlocalhost:18085,two\r\n\r\n", "utf8");
  // .dat sisa: tidak dirujuk script mana pun (seperti subTrans.dat di BP000_VugenWeb)
  await fs.writeFile(path.join(scriptDir, "subTrans.dat"), "subTrans\r\n25\r\n", "utf8");
  await fs.writeFile(path.join(scriptDir, "demo.prm"), '[parameter:Host]\r\nType="Table"\r\n', "utf8");
  await fs.writeFile(path.join(scriptDir, "vuser_init.c"), "vuser_init()\r\n{\r\n    return 0;\r\n}\r\n", "utf8");
  await fs.writeFile(path.join(scriptDir, "vuser_end.c"), "vuser_end()\r\n{\r\n    return 0;\r\n}\r\n", "utf8");
  await fs.writeFile(
    path.join(scriptDir, "Action.c"),
    'Action()\r\n{\r\n    web_url("p", "URL=http://{Host}/echo-headers?s={pathSuffix}", LAST);\r\n    return 0;\r\n}\r\n',
    "utf8",
  );
  scriptDir = await fs.realpath(scriptDir);
  await startMockServer(18085);
});

afterAll(async () => {
  await stopMockServer();
  if (previousCache === undefined) delete process.env.VUGEN_CACHE_DIR;
  else process.env.VUGEN_CACHE_DIR = previousCache;
  await fs.rm(base, { recursive: true, force: true });
});

describe("parameter .dat dipakai runner", () => {
  it("{Host}/{pathSuffix} terisi dari .dat tanpa lr_save_string; maju per iterasi, wrap di akhir, kolom sebaris", async () => {
    const run = await startRun({ scriptDir, options: { iterations: 3 } });
    const result = await run.done;

    expect(result.status).toBe("passed");
    expect(result.steps.map((s) => s.request.url)).toEqual([
      "http://127.0.0.1:18085/echo-headers?s=one",
      "http://localhost:18085/echo-headers?s=two",
      "http://127.0.0.1:18085/echo-headers?s=one", // wrap ke baris pertama
    ]);
    expect(result.log.some((entry) => /Parameter .* not found/.test(entry.msg))).toBe(false);
  }, 30000);
});

describe(".dat yang tidak dipakai script", () => {
  it("tidak menjadi parameter run (tidak di params maupun perubahan step) dan dicatat di log", async () => {
    const run = await startRun({ scriptDir, options: { iterations: 1 } });
    const result = await run.done;

    expect(result.params.subTrans).toBeUndefined();
    expect(result.steps.flatMap((step) => step.params).some((change) => change.name === "subTrans")).toBe(false);
    expect(result.params.Host).toBeDefined(); // yang dipakai tetap dimuat
    expect(result.log.some((entry) => /tidak dipakai script/.test(entry.msg) && /subTrans \(subTrans\.dat\)/.test(entry.msg))).toBe(true);
  }, 30000);
});

describe("GET /api/project: parameters", () => {
  it("array biasa { name, file, rows } tanpa nilai; tidak ada parameterFiles", async () => {
    const server = createServer(apiRouter);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/project?path=${encodeURIComponent(scriptDir)}`;
      const project = await (await fetch(url)).json();

      expect(project.parameterFiles).toBeUndefined();
      // API tetap mendaftar semua kolom .dat (termasuk yang tidak dipakai run); nilai tidak dikirim
      expect(project.parameters).toEqual([
        { name: "Host", file: "hosts.dat", rows: 2 },
        { name: "pathSuffix", file: "hosts.dat", rows: 2 },
        { name: "subTrans", file: "subTrans.dat", rows: 1 },
      ]);
      expect(JSON.stringify(project)).not.toContain("localhost:18085"); // nilai tidak bocor ke browser
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
