import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { apiRouter } from "../routes/index.js";

let server;
let base;

beforeAll(async () => {
  server = createServer((req, res) => apiRouter(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("GET /api/health", () => {
  it("mengembalikan { ok: true }", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("menerima path tanpa prefix /api (perilaku Connect saat di-mount)", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
  });
});

describe("route tidak dikenal", () => {
  it("mengembalikan 404 JSON", async () => {
    const res = await fetch(`${base}/api/tidak-ada`);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) });
  });
});

describe("method tidak didukung", () => {
  it("mengembalikan 405", async () => {
    const res = await fetch(`${base}/api/health`, { method: "POST" });
    expect(res.status).toBe(405);
  });
});

describe("dispatch multi-method pada path yang sama", () => {
  it("PUT /api/file tanpa body -> 400, bukan 405", async () => {
    const res = await fetch(`${base}/api/file`, { method: "PUT" });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) });
  });
});
