/**
 * Test F7b: web_reg_save_param_json terhadap mock lokal (port 18087).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { HttpClient } from "../runtime/http-client.js";
import * as api from "../runtime/vuser-api.js";
import { startMockServer, stopMockServer } from "./mock.js";

const BASE = "http://127.0.0.1:18087";
let tmpDir;
let env;
const clients = [];

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-json-test-"));
  await startMockServer(18087);
});

afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()));
  await stopMockServer();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  const events = [];
  const logs = [];
  const http = new HttpClient({ timeoutMs: 5000 });
  clients.push(http);
  const ctx = {
    http,
    params: new Map(),
    transactions: new Map(),
    transactionResults: new Map(),
    currentFile: "t.c",
    currentLine: 3,
    currentIteration: 1,
    runOptions: { thinkTime: "ignore", timeoutMs: 5000, continueOnError: false },
    seq: 0,
    stepFailures: 0,
    runStartMs: Date.now(),
    cacheDir: tmpDir,
    runId: "2026-10-16T00-00-00-000Z-abcdef12",
    log: (level, msg) => logs.push([level, msg]),
    sendEvent: (type, data) => events.push({ type, data }),
  };
  api.__bind(ctx);
  api.web_cleanup_auto_headers();
  api.__resetHeaders();
  env = { ctx, events, logs };
});

const params = () => Object.fromEntries(env.ctx.params);
const steps = () => env.events.filter((e) => e.type === "step").map((e) => e.data);
const get = (name = "json") => api.web_url(name, `URL=${BASE}/json`, "LAST");

describe("web_reg_save_param_json: pola KOPRA", () => {
  it("$.a.b.c (path lengkap) + SEARCH_FILTERS + Scope=BODY", async () => {
    api.web_reg_save_param_json("ParamName=kopraId", "QueryString=$.data.profile.kopraId", "SEARCH_FILTERS", "Scope=BODY", "LAST");
    await get();
    expect(params().kopraId).toBe("K-9");
  });

  it("$..a (recursive) tanpa Scope; ambil match pertama", async () => {
    api.web_reg_save_param_json("ParamName=companyUUID", "QueryString=$..companyId", "SEARCH_FILTERS", "LAST");
    await get();
    expect(params().companyUUID).toBe("C-1");
  });

  it("$.a.b[n].c dan $.a", async () => {
    api.web_reg_save_param_json("ParamName=second", "QueryString=$.data.items[1].id", "LAST");
    api.web_reg_save_param_json("ParamName=top", "QueryString=$.requestId", "LAST");
    await get();
    expect(params()).toMatchObject({ second: "20", top: "R-77" });
  });

  it("Scope=ALL diperlakukan sebagai BODY (tanpa warning); Scope lain -> warn", async () => {
    api.web_reg_save_param_json("ParamName=a", "QueryString=$.requestId", "Scope=ALL", "LAST");
    expect(env.logs.some(([level]) => level === "warn")).toBe(false);
    api.web_reg_save_param_json("ParamName=b", "QueryString=$.requestId", "Scope=HEADERS", "LAST");
    expect(env.logs.some(([level, msg]) => level === "warn" && /Scope=HEADERS/.test(msg))).toBe(true);
    await get();
    expect(params()).toMatchObject({ a: "R-77", b: "R-77" });
  });

  it("token hasil correlation dipakai di request berikutnya ({param} di header)", async () => {
    api.web_reg_save_param_json("ParamName=token", "QueryString=$..token", "SEARCH_FILTERS", "LAST");
    await get("ambil-token");
    api.web_add_header("X-Token", "{token}");
    await api.web_url("pakai-token", `URL=${BASE}/echo-headers`, "LAST");
    expect(steps()[1].request.headers["x-token"]).toBe("tok-123");
  });
});

describe("web_reg_save_param_json: nilai & atribut", () => {
  it("tipe nilai: angka/boolean -> String; null -> 'null'; objek/array -> JSON.stringify", async () => {
    api.web_reg_save_param_json("ParamName=n", "QueryString=$.data.count", "LAST");
    api.web_reg_save_param_json("ParamName=f", "QueryString=$.data.flag", "LAST");
    api.web_reg_save_param_json("ParamName=nul", "QueryString=$.data.nothing", "LAST");
    api.web_reg_save_param_json("ParamName=obj", "QueryString=$.data.profile", "LAST");
    api.web_reg_save_param_json("ParamName=arr", "QueryString=$.data.tags", "LAST");
    await get();
    expect(params()).toMatchObject({ n: "3", f: "true", nul: "null", obj: '{"kopraId":"K-9","companyId":"C-1"}', arr: '["a","b"]' });
  });

  it("Ordinal memilih match ke-n (1-based)", async () => {
    api.web_reg_save_param_json("ParamName=o2", "QueryString=$..companyId", "Ordinal=2", "LAST");
    await get();
    expect(params().o2).toBe("C-2");
  });

  it("Ordinal di luar jumlah match = NotFound", async () => {
    env.ctx.runOptions.continueOnError = true;
    api.web_reg_save_param_json("ParamName=o9", "QueryString=$..companyId", "Ordinal=9", "LAST");
    await get();
    expect(steps()[0].error).toMatch(/o9.*tidak ditemukan/);
    expect(env.ctx.params.has("o9")).toBe(false);
  });

  it("SelectAll=Yes -> name_1..name_n + name_count; hasil lama dibersihkan", async () => {
    api.web_reg_save_param_json("ParamName=id", "QueryString=$.data.items[*].id", "SelectAll=Yes", "LAST");
    await get();
    expect(params()).toMatchObject({ id_count: "3", id_1: "10", id_2: "20", id_3: "30" });

    // registrasi ulang dengan hasil lebih sedikit: id_3 lama tidak boleh tersisa
    api.web_reg_save_param_json("ParamName=id", "QueryString=$.data.items[0].id", "SelectAll=Yes", "LAST");
    await get();
    expect(params()).toMatchObject({ id_count: "1", id_1: "10" });
    expect(env.ctx.params.has("id_2")).toBe(false);
    expect(env.ctx.params.has("id_3")).toBe(false);
  });

  it("registrasi hanya berlaku untuk satu request berikutnya", async () => {
    api.web_reg_save_param_json("ParamName=once", "QueryString=$.requestId", "LAST");
    await get();
    env.ctx.params.delete("once");
    await get();
    expect(env.ctx.params.has("once")).toBe(false);
  });

  it("atribut tak dikenal diabaikan dengan warning", () => {
    api.web_reg_save_param_json("ParamName=x", "QueryString=$.a", "Bogus=1", "LAST");
    expect(env.logs.some(([level, msg]) => level === "warn" && /Bogus/.test(msg))).toBe(true);
  });
});

describe("web_reg_save_param_json: tidak ketemu / bukan JSON", () => {
  it("NotFound=Error (default): step gagal (perilaku S5) dan lempar", async () => {
    api.web_reg_save_param_json("ParamName=hilang", "QueryString=$.tidakAda", "LAST");
    await expect(get()).rejects.toThrow(/hilang.*tidak ditemukan/);
    expect(steps()[0].error).toMatch(/\$\.tidakAda/);
  });

  it("NotFound=Warning: hanya log warn, step sukses", async () => {
    api.web_reg_save_param_json("ParamName=hilang", "QueryString=$.tidakAda", "NotFound=Warning", "LAST");
    expect(await get()).toBe(0);
    expect(steps()[0].error).toBeNull();
    expect(env.logs.some(([level, msg]) => level === "warn" && /hilang/.test(msg))).toBe(true);
  });

  it("body bukan JSON valid: diperlakukan sebagai tidak ketemu (Error / Warning)", async () => {
    api.web_reg_save_param_json("ParamName=p", "QueryString=$.a", "LAST");
    await expect(api.web_url("teks", `URL=${BASE}/not-json`, "LAST")).rejects.toThrow(/bukan JSON/);

    api.web_reg_save_param_json("ParamName=p", "QueryString=$.a", "NotFound=Warning", "LAST");
    expect(await api.web_url("teks", `URL=${BASE}/not-json`, "LAST")).toBe(0);
  });
});

describe("web_reg_save_param_json: registrasi tidak valid", () => {
  it("QueryString dengan sintaks tidak didukung -> error jelas (lempar, atau return 1 dengan continueOnError)", () => {
    expect(() => api.web_reg_save_param_json("ParamName=x", "QueryString=$.a[?(@.b==1)]", "LAST")).toThrow(/tidak didukung/);
    env.ctx.runOptions.continueOnError = true;
    expect(api.web_reg_save_param_json("ParamName=x", "QueryString=$.a[?(@.b==1)]", "LAST")).toBe(1);
    expect(env.logs.some(([level, msg]) => level === "error" && /web_reg_save_param_json gagal/.test(msg))).toBe(true);
  });

  it("ParamName / QueryString wajib", () => {
    expect(() => api.web_reg_save_param_json("QueryString=$.a", "LAST")).toThrow(/ParamName/);
    expect(() => api.web_reg_save_param_json("ParamName=x", "LAST")).toThrow(/QueryString/);
  });
});
