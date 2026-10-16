/**
 * Test lifecycle child process (S3): Stop, killAllRuns, replay history.
 *
 * Memakai mock di port 18082 (beda dengan run.f5.test.js yang memakai 18081)
 * supaya file test bisa berjalan paralel.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import { apiRouter } from "../routes/index.js";
import { startRun } from "../runs/execute.js";
import { getRun, killAllRuns, runningRunCount, stopRun } from "../runs/registry.js";
import { cacheDirFor, resolveScriptDir } from "../project/paths.js";
import { startMockServer, stopMockServer } from "./mock.js";

const SLOW_DIR = path.resolve("server/test/__fixtures__/slow-script");

let tmpCache;
let previousCache;

beforeAll(async () => {
  previousCache = process.env.VUGEN_CACHE_DIR;
  tmpCache = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-lifecycle-test-"));
  process.env.VUGEN_CACHE_DIR = tmpCache;
  await startMockServer(18082);
});

afterAll(async () => {
  killAllRuns();
  await stopMockServer();
  if (previousCache === undefined) delete process.env.VUGEN_CACHE_DIR;
  else process.env.VUGEN_CACHE_DIR = previousCache;
  await fs.rm(tmpCache, { recursive: true, force: true });
});

/** Tunggu sampai request ke /slow benar-benar sedang berjalan */
function waitUntilInFlight(run) {
  return new Promise((resolve) => {
    const seen = () => run.history.some((e) => e.type === "log" && /web_url: slow/.test(e.data?.msg ?? ""));
    if (seen()) return resolve();
    const onEvent = () => {
      if (!seen()) return;
      run.events.off("event", onEvent);
      resolve();
    };
    run.events.on("event", onEvent);
  });
}

/** Promise yang resolve saat child exit, beserta waktu keluarnya (ms epoch) */
function exitTime(child) {
  return new Promise((resolve) => child.once("exit", () => resolve(Date.now())));
}

describe("lifecycle run", () => {
  it("Stop: child exit < 2 s, status stopped, run.json tersimpan", async () => {
    const run = await startRun({ scriptDir: SLOW_DIR, options: { iterations: 1 } });
    await waitUntilInFlight(run);
    expect(getRun(run.runId)).toBe(run);

    const exited = exitTime(run.child);
    const t0 = Date.now();
    expect(stopRun(run.runId)).toBe(true);

    const exitedAt = await exited;
    expect(exitedAt - t0).toBeLessThan(2000);

    const result = await run.done;
    expect(result.status).toBe("stopped");
    expect(run.history.at(-1)).toMatchObject({ type: "done", data: { status: "stopped" } });

    const runJson = path.join(cacheDirFor(await resolveScriptDir(SLOW_DIR)), "runs", run.runId, "run.json");
    const saved = JSON.parse(await fs.readFile(runJson, "utf8"));
    expect(saved.status).toBe("stopped");

    // sudah selesai: stop kedua ditolak
    expect(stopRun(run.runId)).toBe(false);
  }, 20000);

  it("killAllRuns membunuh semua child yang hidup", async () => {
    const a = await startRun({ scriptDir: SLOW_DIR, options: { iterations: 1 } });
    const b = await startRun({ scriptDir: SLOW_DIR, options: { iterations: 1 } });
    await Promise.all([waitUntilInFlight(a), waitUntilInFlight(b)]);
    expect(runningRunCount()).toBe(2);

    const exits = Promise.all([exitTime(a.child), exitTime(b.child)]);
    expect(killAllRuns()).toBe(2);
    await exits;

    const [ra, rb] = await Promise.all([a.done, b.done]);
    expect(ra.status).toBe("failed");
    expect(rb.status).toBe("failed");
    expect(runningRunCount()).toBe(0);
  }, 20000);
});

/** Server HTTP kecil di atas apiRouter (tanpa Vite) */
async function withApi(fn) {
  const server = createServer(apiRouter);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Baca seluruh stream SSE sampai server menutupnya; kembalikan daftar nama event */
async function readSseEvents(url) {
  const res = await fetch(url);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const text = await res.text();
  return [...text.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
}

describe("routing + SSE", () => {
  it("push event live, tutup setelah done, dan replay untuk klien yang terlambat", async () => {
    await withApi(async (base) => {
      const started = await fetch(`${base}/api/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: SLOW_DIR, options: { iterations: 1 } }),
      });
      expect(started.status).toBe(200);
      const { runId } = await started.json();
      const run = getRun(runId);
      await waitUntilInFlight(run);

      const live = readSseEvents(`${base}/api/run/${runId}/events`);
      const stopped = await fetch(`${base}/api/run/${runId}/stop`, { method: "POST" });
      expect(stopped.status).toBe(200);

      const liveEvents = await live;
      expect(liveEvents).toContain("started");
      expect(liveEvents).toContain("stopped");
      expect(liveEvents.at(-1)).toBe("done");

      // klien terlambat: semua history ter-replay lalu stream ditutup
      const replay = await readSseEvents(`${base}/api/run/${runId}/events`);
      expect(replay).toEqual(liveEvents);
    });
  }, 20000);

  it("runId / seq tidak valid → 400; run tak dikenal → 404; /debug sudah tidak ada", async () => {
    await withApi(async (base) => {
      expect((await fetch(`${base}/api/run/..%2F..%2Fx/events`)).status).toBe(400);
      expect((await fetch(`${base}/api/run/2026-10-16T05-00-00-000Z-deadbeef/events`)).status).toBe(404);
      expect((await fetch(`${base}/api/run/2026-10-16T05-00-00-000Z-deadbeef/step/0/body?path=x`)).status).toBe(400);
      expect((await fetch(`${base}/api/run/2026-10-16T05-00-00-000Z-deadbeef/debug`)).status).toBe(404);
    });
  });
});
