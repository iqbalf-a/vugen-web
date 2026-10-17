/**
 * Test F6: mesin parameter .prm — SelectNextRow (Sequential/Random/Unique),
 * UpdateValueOn (Once), OutOfRangePolicy (Cycle/Continue/Abort).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import { startRun } from "../runs/execute.js";

let base;
let previousCache;
let mockServer;
let mockPort;

beforeAll(async () => {
  previousCache = process.env.VUGEN_CACHE_DIR;
  base = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-prm-run-"));
  process.env.VUGEN_CACHE_DIR = path.join(base, "cache");

  mockServer = await new Promise((resolve) => {
    const s = createServer((req, res) => { req.resume(); req.on("end", () => { res.writeHead(200); res.end("ok"); }); });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  mockPort = mockServer.address().port;
});

afterAll(async () => {
  mockServer.closeAllConnections?.();
  await new Promise((r) => mockServer.close(r));
  if (previousCache === undefined) delete process.env.VUGEN_CACHE_DIR;
  else process.env.VUGEN_CACHE_DIR = previousCache;
  await fs.rm(base, { recursive: true, force: true });
});

/** Tulis file script minimal ke dir */
async function writeScript(dir, pathParam) {
  await fs.writeFile(path.join(dir, "vuser_init.c"), "vuser_init()\n{\n    return 0;\n}\n", "utf8");
  await fs.writeFile(path.join(dir, "vuser_end.c"), "vuser_end()\n{\n    return 0;\n}\n", "utf8");
  await fs.writeFile(
    path.join(dir, "Action.c"),
    `Action()\n{\n    web_url("s", "URL=http://127.0.0.1:${mockPort}/{${pathParam}}", LAST);\n    return 0;\n}\n`,
    "utf8",
  );
}

describe("SelectNextRow=Sequential + OutOfRangePolicy=Cycle (default via .dat tanpa .prm)", () => {
  it("3 iterasi dari 2 baris: row0, row1, row0 (wrap)", async () => {
    const dir = await fs.mkdtemp(path.join(base, "seq-"));
    await fs.writeFile(path.join(dir, "seg.dat"), "seg\nfirst\nsecond\n", "utf8");
    await writeScript(dir, "seg");
    const run = await startRun({ scriptDir: dir, options: { iterations: 3 } });
    const result = await run.done;
    expect(result.status).toBe("passed");
    expect(result.steps.map((s) => s.request.url)).toEqual([
      `http://127.0.0.1:${mockPort}/first`,
      `http://127.0.0.1:${mockPort}/second`,
      `http://127.0.0.1:${mockPort}/first`,
    ]);
  }, 30000);
});

describe("SelectNextRow=Sequential + OutOfRangePolicy=Continue", () => {
  it("3 iterasi dari 2 baris: row0, row1, row1 (tetap di baris terakhir)", async () => {
    const dir = await fs.mkdtemp(path.join(base, "cont-"));
    await fs.writeFile(path.join(dir, "seg.dat"), "seg\nfirst\nsecond\n", "utf8");
    await fs.writeFile(path.join(dir, "seg.prm"), '[parameter:seg]\nType="Table"\nSelectNextRow="Sequential"\nWhenOutOfValues="Continue"\n', "utf8");
    await writeScript(dir, "seg");
    const run = await startRun({ scriptDir: dir, options: { iterations: 3 } });
    const result = await run.done;
    expect(result.status).toBe("passed");
    expect(result.steps.map((s) => s.request.url)).toEqual([
      `http://127.0.0.1:${mockPort}/first`,
      `http://127.0.0.1:${mockPort}/second`,
      `http://127.0.0.1:${mockPort}/second`,
    ]);
  }, 30000);
});

describe("SelectNextRow=Sequential + OutOfRangePolicy=Abort", () => {
  it("iterasi ke-3 tidak jalan; run=failed; log berisi pesan Abort", async () => {
    const dir = await fs.mkdtemp(path.join(base, "abort-"));
    await fs.writeFile(path.join(dir, "seg.dat"), "seg\nfirst\nsecond\n", "utf8");
    await fs.writeFile(path.join(dir, "seg.prm"), '[parameter:seg]\nType="Table"\nSelectNextRow="Sequential"\nWhenOutOfValues="Abort"\n', "utf8");
    await writeScript(dir, "seg");
    const run = await startRun({ scriptDir: dir, options: { iterations: 3, continueOnError: true } });
    const result = await run.done;
    expect(result.status).toBe("failed");
    expect(result.steps).toHaveLength(2); // hanya 2 iterasi jalan
    expect(result.log.some((e) => /kehabisan nilai.*Abort/i.test(e.msg))).toBe(true);
  }, 30000);
});

describe("SelectNextRow=Unique + OutOfRangePolicy=Cycle", () => {
  it("3 iterasi dari 2 baris: dua nilai unik lalu cycle", async () => {
    const dir = await fs.mkdtemp(path.join(base, "uniq-"));
    await fs.writeFile(path.join(dir, "seg.dat"), "seg\nfirst\nsecond\n", "utf8");
    await fs.writeFile(path.join(dir, "seg.prm"), '[parameter:seg]\nType="Table"\nSelectNextRow="Unique"\nWhenOutOfValues="Cycle"\n', "utf8");
    await writeScript(dir, "seg");
    const run = await startRun({ scriptDir: dir, options: { iterations: 3 } });
    const result = await run.done;
    expect(result.status).toBe("passed");
    const urls = result.steps.map((s) => s.request.url);
    // Iterasi 1 dan 2 berbeda (unique)
    expect(new Set(urls.slice(0, 2)).size).toBe(2);
    // Iterasi 3 kembali ke baris pertama (index 0) setelah cycle
    expect(urls[2]).toBe(urls[0]);
  }, 30000);
});

describe("UpdateValueOn=Once", () => {
  it("3 iterasi: selalu nilai pertama", async () => {
    const dir = await fs.mkdtemp(path.join(base, "once-"));
    await fs.writeFile(path.join(dir, "seg.dat"), "seg\nfirst\nsecond\n", "utf8");
    await fs.writeFile(path.join(dir, "seg.prm"), '[parameter:seg]\nType="Table"\nUpdateValueOn="Once"\n', "utf8");
    await writeScript(dir, "seg");
    const run = await startRun({ scriptDir: dir, options: { iterations: 3 } });
    const result = await run.done;
    expect(result.status).toBe("passed");
    expect(result.steps.map((s) => s.request.url)).toEqual([
      `http://127.0.0.1:${mockPort}/first`,
      `http://127.0.0.1:${mockPort}/first`,
      `http://127.0.0.1:${mockPort}/first`,
    ]);
  }, 30000);
});
