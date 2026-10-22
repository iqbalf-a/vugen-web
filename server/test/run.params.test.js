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

describe("substitusi {param}: kurung kurawal JSON tidak memicu warning", () => {
  it('Body={"key":1} tidak menghasilkan warn Parameter not found', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-json-body-"));
    try {
      await fs.writeFile(path.join(tmpDir, "vuser_init.c"), "vuser_init()\n{\n    return 0;\n}\n", "utf8");
      await fs.writeFile(path.join(tmpDir, "vuser_end.c"), "vuser_end()\n{\n    return 0;\n}\n", "utf8");
      const mockServer = await new Promise((resolve) => {
        const s = createServer((req, res) => { req.resume(); req.on("end", () => { res.writeHead(200); res.end("{}"); }); });
        s.listen(0, "127.0.0.1", () => resolve(s));
      });
      const mockPort = mockServer.address().port;
      // Tulis ulang Action.c dengan port dinamis
      await fs.writeFile(
        path.join(tmpDir, "Action.c"),
        `Action()\n{\n    web_custom_request("step",\n        "URL=http://127.0.0.1:${mockPort}/",\n        "Method=POST",\n        "EncType=application/json",\n        "Body={\\"a\\":1,\\"b\\":\\"hello\\"}",\n        LAST);\n    return 0;\n}\n`,
        "utf8"
      );
      try {
        const run = await startRun({ scriptDir: tmpDir, options: { iterations: 1 } });
        const result = await run.done;
        const warnMsgs = result.log.filter((e) => e.level === "warn" && /Parameter.*not found/.test(e.msg));
        expect(warnMsgs).toHaveLength(0);
      } finally {
        mockServer.closeAllConnections?.();
        await new Promise((resolve) => mockServer.close(resolve));
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 30000);
});

describe("GET /api/project: parameters", () => {
  it("array biasa { name, file, rows, column, ... } tanpa nilai; tidak ada parameterFiles", async () => {
    const server = createServer(apiRouter);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/project?path=${encodeURIComponent(scriptDir)}`;
      const project = await (await fetch(url)).json();

      expect(project.parameterFiles).toBeUndefined();
      // API mendaftar semua kolom .dat; values dikirim (dibatasi 500 baris untuk modal UI)
      expect(project.parameters.map(({ name, file, rows, column }) => ({ name, file, rows, column }))).toEqual([
        { name: "Host", file: "hosts.dat", rows: 2, column: "Host" },
        { name: "pathSuffix", file: "hosts.dat", rows: 2, column: "pathSuffix" },
        { name: "subTrans", file: "subTrans.dat", rows: 1, column: "subTrans" },
      ]);
      expect(project.parameters.every((p) => "values" in p && Array.isArray(p.values))).toBe(true);
      // values dikirim ke browser untuk modal parameter (dibatasi 500 baris)
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('SelectNextRow="Same line as X"', () => {
  it("pengikut selalu di baris induk; policy induk berlaku walau pengikut punya policy sendiri; induk ikut dimuat", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-sameline-"));
    const prm = (name, table, extra) =>
      [`[parameter:${name}]`, 'Type="Table"', `Table="${table}"`, 'ColumnName="Col 1"', ...extra].join("\r\n");
    try {
      await fs.writeFile(path.join(dir, "maker.dat"), "m\nm1\nm2\n", "utf8");
      await fs.writeFile(path.join(dir, "approver.dat"), "a\na1\na2\n", "utf8");
      await fs.writeFile(
        path.join(dir, "s.prm"),
        [
          prm("maker", "maker.dat", ['SelectNextRow="Sequential"', 'OutOfRangePolicy="ContinueWithLast"']),
          prm("approver", "approver.dat", ['SelectNextRow="Same line as maker"', 'OutOfRangePolicy="AbortVuser"']),
          "",
        ].join("\r\n"),
        "utf8",
      );
      await fs.writeFile(path.join(dir, "vuser_init.c"), "vuser_init()\n{\n    return 0;\n}\n", "utf8");
      await fs.writeFile(path.join(dir, "vuser_end.c"), "vuser_end()\n{\n    return 0;\n}\n", "utf8");
      // hanya {approver} yang dirujuk: induk (maker) harus tetap dimuat supaya baris bisa diikuti
      await fs.writeFile(
        path.join(dir, "Action.c"),
        'Action()\n{\n    web_url("p", "URL=http://127.0.0.1:18085/echo-headers?s={approver}", LAST);\n    return 0;\n}\n',
        "utf8",
      );
      const real = await fs.realpath(dir);

      const result = await (await startRun({ scriptDir: real, options: { iterations: 3 } })).done;
      expect(result.status).toBe("passed");
      expect(result.steps.map((s) => s.request.url.split("s=")[1])).toEqual(["a1", "a2", "a2"]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});
