/**
 * Unit test runtime (S5, R1–R8): fungsi vuser-api.js + http-client.js terhadap mock lokal.
 * Tidak ada request ke server luar; mock di port 18083.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import { createServer } from "node:https";
import os from "node:os";
import path from "node:path";

import { HttpClient } from "../runtime/http-client.js";
import * as api from "../runtime/vuser-api.js";
import { startMockServer, stopMockServer } from "./mock.js";

const BASE = "http://127.0.0.1:18083";
const RUN_ID = "2026-10-16T00-00-00-000Z-abcdef12";

let tmpDir;
/** @type {{ events: any[], logs: [string, string][], ctx: any }} */
let env;
let clients = [];

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-runtime-test-"));
  await startMockServer(18083);
});

afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()));
  await stopMockServer();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Konteks `vu` palsu + HttpClient asli; semua event/log ditampung untuk assertion. */
function bindContext(overrides = {}) {
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
    currentLine: 7,
    currentIteration: 1,
    runOptions: { thinkTime: "ignore", timeoutMs: 5000, continueOnError: false },
    seq: 0,
    runStartMs: Date.now(),
    cacheDir: tmpDir,
    runId: RUN_ID,
    log: (level, msg) => logs.push([level, msg]),
    sendEvent: (type, data) => events.push({ type, data }),
    ...overrides,
  };
  api.__bind(ctx);
  return { events, logs, ctx };
}

const steps = () => env.events.filter((e) => e.type === "step").map((e) => e.data);
const transactions = () => env.events.filter((e) => e.type === "transaction").map((e) => e.data);

beforeEach(() => {
  env = bindContext();
  api.web_cleanup_auto_headers();
  api.__resetHeaders();
});

describe("R1 web_js_run", () => {
  it("Code= di SOURCES dijalankan lebih dulu, lalu Code= utama (pola KOPRA): subTrans & transSeqName terisi", async () => {
    env.ctx.params.set("parentTrans", "RPS_BP211_01_exc");
    const result = await api.web_js_run(
      "Code= myFunc(LR.getParam('parentTrans'));",
      "SOURCES",
      "Code= var myFunc = function(parentTrans) { " +
        "LR.setParam('subTrans', parentTrans.match(/.*?_[0-9][0-9]/));" +
        "LR.setParam('transSeqName', parentTrans.match(/.+(?=_exc)/)); " +
        "}",
      "ENDITEM",
      "LAST",
    );
    expect(result).toBe(0);
    expect(env.ctx.params.get("subTrans")).toBe("RPS_BP211_01");
    expect(env.ctx.params.get("transSeqName")).toBe("RPS_BP211_01");
  });

  it("beberapa SOURCES saling memakai definisi, urutan dari atas ke bawah", async () => {
    await api.web_js_run(
      "Code= LR.setParam('out', double(add(1, 2)));",
      "SOURCES",
      "Code= function add(a, b) { return a + b; }",
      "Code= function double(x) { return x * 2; }",
      "ENDITEM",
      "LAST",
    );
    expect(env.ctx.params.get("out")).toBe("6");
  });

  it("tanpa SOURCES: Code= tunggal", async () => {
    await api.web_js_run("Code= LR.setParam('x', 'ok');", "LAST");
    expect(env.ctx.params.get("x")).toBe("ok");
  });

  it("loop tak berujung dihentikan oleh timeout dan diperlakukan seperti error web_* (lempar)", async () => {
    api.lr_start_transaction("T_JS");
    const t0 = Date.now();
    await expect(api.web_js_run("Code= while (true) {}", "LAST")).rejects.toThrow(/web_js_run: .*(timed out|Script execution)/i);
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(env.logs.some(([level, msg]) => level === "error" && /web_js_run gagal/.test(msg))).toBe(true);
    expect(api.lr_get_transaction_status("T_JS")).toBe(1); // transaksi terbuka ditandai gagal
    expect(steps()).toEqual([]); // tidak ada entri step palsu
  });

  it("continueOnError: error web_js_run -> log error, return 1, script lanjut", async () => {
    env.ctx.runOptions.continueOnError = true;
    api.lr_start_transaction("T_JS");
    expect(await api.web_js_run("Code= throw new Error('boom');", "LAST")).toBe(1);
    expect(env.logs.some(([level, msg]) => level === "error" && /web_js_run gagal: boom/.test(msg))).toBe(true);
    expect(api.lr_get_transaction_status("T_JS")).toBe(1);
    expect(steps()).toEqual([]);
  });

  it("kode tidak bisa mengakses global proses (require/process)", async () => {
    await api.web_js_run("Code= LR.setParam('t', typeof process + '/' + typeof require);", "LAST");
    expect(env.ctx.params.get("t")).toBe("undefined/undefined");
  });
});

describe("R2 header: auto vs sekali pakai", () => {
  const headersOf = (step) => step.request.headers;

  it("web_add_header hanya untuk satu request berikutnya; auto header permanen", async () => {
    api.web_add_auto_header("Accept-Language", "id-ID");
    api.web_add_header("X-Sekali", "1");

    await api.web_url("satu", `URL=${BASE}/echo-headers`, "LAST");
    await api.web_url("dua", `URL=${BASE}/echo-headers`, "LAST");

    const [first, second] = steps();
    expect(headersOf(first)).toMatchObject({ "accept-language": "id-ID", "x-sekali": "1" });
    expect(headersOf(second)["accept-language"]).toBe("id-ID");
    expect(headersOf(second)["x-sekali"]).toBeUndefined();
  });

  it("__resetHeaders (user baru) membuang header sekali pakai tapi mempertahankan auto header", async () => {
    api.web_add_auto_header("X-Auto", "tetap");
    api.web_add_header("X-Next", "buang");
    api.__resetHeaders();

    await api.web_url("cek", `URL=${BASE}/echo-headers`, "LAST");
    expect(headersOf(steps()[0])["x-auto"]).toBe("tetap");
    expect(headersOf(steps()[0])["x-next"]).toBeUndefined();
  });

  it("{param} di nilai header disubstitusi saat fungsi dipanggil (pola KOPRA: companyId={companyId})", async () => {
    env.ctx.params.set("companyId", "C-42");
    api.web_add_auto_header("companyId", "{companyId}");
    api.web_add_header("X-Once", "v-{companyId}");
    env.ctx.params.set("companyId", "BERUBAH"); // perubahan sesudah pemanggilan tidak mempengaruhi header
    await api.web_url("cek", `URL=${BASE}/echo-headers`, "LAST");
    expect(headersOf(steps()[0])).toMatchObject({ companyid: "C-42", "x-once": "v-C-42" });
  });

  it("web_cleanup_auto_headers menghapus auto header", async () => {
    api.web_add_auto_header("X-Auto", "ada");
    api.web_cleanup_auto_headers();
    await api.web_url("cek", `URL=${BASE}/echo-headers`, "LAST");
    expect(headersOf(steps()[0])["x-auto"]).toBeUndefined();
  });

  it("header sekali pakai tetap habis walau request gagal", async () => {
    env.ctx.runOptions.continueOnError = true;
    api.web_add_header("X-Gagal", "1");
    await api.web_url("gagal", `URL=${BASE}/status/500`, "LAST");
    await api.web_url("sesudah", `URL=${BASE}/echo-headers`, "LAST");
    expect(headersOf(steps()[1])["x-gagal"]).toBeUndefined();
  });

  it("Referer= kosong tidak mengirim header referer", async () => {
    await api.web_url("ref", `URL=${BASE}/echo-headers`, "Referer=", "LAST");
    expect(headersOf(steps()[0]).referer).toBeUndefined();
    await api.web_url("ref2", `URL=${BASE}/echo-headers`, `Referer=${BASE}/asal`, "LAST");
    expect(headersOf(steps()[1]).referer).toBe(`${BASE}/asal`);
  });
});

describe("R3 web_add_cookie", () => {
  const echoedCookie = async () => {
    const before = steps().length;
    await api.web_url("cookie", `URL=${BASE}/echo-headers`, "LAST");
    return steps()[before].request.headers.Cookie ?? "";
  };

  it("DOMAIN= dipakai sebagai konteks dan {param} disubstitusi", async () => {
    env.ctx.params.set("sid", "abc123");
    expect(await api.web_add_cookie("session={sid}; DOMAIN=127.0.0.1; PATH=/")).toBe(0);
    expect(await echoedCookie()).toContain("session=abc123");
  });

  it("tanpa DOMAIN= memakai URL request terakhir", async () => {
    await api.web_url("awal", `URL=${BASE}/echo-headers`, "LAST");
    expect(await api.web_add_cookie("tanpa=domain; PATH=/")).toBe(0);
    expect(await echoedCookie()).toContain("tanpa=domain");
  });

  it("cookie untuk DOMAIN lain tidak ikut terkirim ke host mock", async () => {
    expect(await api.web_add_cookie("x=1; DOMAIN=bukan.example.org; PATH=/")).toBe(0);
    expect(await echoedCookie()).not.toContain("x=1");
  });

  it("cookie tidak valid ditolak -> log warn, return -1, tidak crash", async () => {
    await api.web_url("awal", `URL=${BASE}/echo-headers`, "LAST");
    expect(await api.web_add_cookie(";;;")).toBe(-1);
    expect(env.logs.some(([level, msg]) => level === "warn" && /web_add_cookie ditolak/.test(msg))).toBe(true);
  });

  it("web_cleanup_cookies membersihkan jar", async () => {
    await api.web_add_cookie("a=1; DOMAIN=127.0.0.1; PATH=/");
    api.web_cleanup_cookies();
    expect(await echoedCookie()).not.toContain("a=1");
  });
});

describe("R4 printf di lr_output_message / lr_error_message / sprintf", () => {
  it("lr_output_message memakai format printf lengkap", () => {
    api.lr_output_message("[%05d] %s %.2f%% %c", 42, "ok", 12.345, 65);
    expect(env.logs.at(-1)).toEqual(["info", "[00042] ok 12.35% A"]);
  });

  it("lr_error_message: level error, %% tanpa argumen tidak menggeser", () => {
    api.lr_error_message("100%% gagal: %s", "x");
    expect(env.logs.at(-1)).toEqual(["error", "100% gagal: x"]);
  });

  it("sprintf(format, ...args) mengembalikan string terformat", () => {
    expect(api.sprintf("%s_%03d", "id", 7)).toBe("id_007");
  });
});

describe("R5 transaksi", () => {
  it("LR_AUTO tanpa step gagal -> Pass; event membawa iteration", async () => {
    env.ctx.currentIteration = 3;
    api.lr_start_transaction("T1");
    await api.web_url("ok", `URL=${BASE}/echo-headers`, "LAST");
    api.lr_end_transaction("T1", 2);
    expect(transactions()).toEqual([expect.objectContaining({ name: "T1", status: "Pass", iteration: 3 })]);
    expect(api.lr_get_transaction_status("T1")).toBe(0);
  });

  it("LR_AUTO dengan step 500 -> Fail dan lr_get_transaction_status = LR_FAIL (1)", async () => {
    env.ctx.runOptions.continueOnError = true;
    api.lr_start_transaction("T2");
    await api.web_url("rusak", `URL=${BASE}/status/500`, "LAST");
    expect(api.lr_get_transaction_status("T2")).toBe(1); // sudah gagal selagi terbuka
    api.lr_end_transaction("T2", 2);
    expect(transactions()[0]).toMatchObject({ name: "T2", status: "Fail" });
    expect(api.lr_get_transaction_status("T2")).toBe(1); // tetap gagal setelah selesai
  });

  it("status eksplisit dihormati (angka dan string lama)", () => {
    api.lr_start_transaction("A");
    api.lr_end_transaction("A", 1);
    api.lr_start_transaction("B");
    api.lr_end_transaction("B", "LR_FAIL");
    api.lr_start_transaction("C");
    api.lr_end_transaction("C", 0);
    api.lr_start_transaction("D");
    api.lr_end_transaction("D", "LR_PASS");
    expect(transactions().map((t) => t.status)).toEqual(["Fail", "Fail", "Pass", "Pass"]);
  });

  it("transaksi bersarang: step gagal menggagalkan semua yang terbuka; step.transaction = terdalam", async () => {
    env.ctx.runOptions.continueOnError = true;
    api.lr_start_transaction("luar");
    api.lr_start_transaction("dalam");
    await api.web_url("ok-dalam", `URL=${BASE}/echo-headers`, "LAST");
    api.lr_end_transaction("dalam", 2); // sebelum gagal -> Pass
    await api.web_url("rusak-luar", `URL=${BASE}/status/404`, "LAST");
    api.lr_end_transaction("luar", 2);

    expect(steps().map((s) => s.transaction)).toEqual(["dalam", "luar"]);
    expect(Object.fromEntries(transactions().map((t) => [t.name, t.status]))).toEqual({ dalam: "Pass", luar: "Fail" });
  });

  it("transaksi dengan nama yang sama di iterasi berikutnya tidak mewarisi status lama", async () => {
    env.ctx.runOptions.continueOnError = true;
    api.lr_start_transaction("T");
    await api.web_url("rusak", `URL=${BASE}/status/500`, "LAST");
    api.lr_end_transaction("T", 2);
    api.lr_start_transaction("T");
    expect(api.lr_get_transaction_status("T")).toBe(0);
    api.lr_end_transaction("T", 2);
    expect(transactions().map((t) => t.status)).toEqual(["Fail", "Pass"]);
  });

  it("lr_end_transaction untuk transaksi yang tidak terbuka -> warn, tidak crash", () => {
    expect(api.lr_end_transaction("hantu", 2)).toBe(1);
    expect(env.logs.some(([level, msg]) => level === "warn" && /hantu/.test(msg))).toBe(true);
    expect(transactions()).toEqual([]);
  });

  it("lr_set_transaction mencatat transaksi: durasi DETIK x 1000 = durationMs (konsisten dengan lr_end_timer)", () => {
    api.lr_set_transaction("manual", 1.5, 1);
    api.lr_set_transaction("manual2", 0.25, 2);
    api.lr_set_transaction("kecil", 0.0042, 0);
    api.lr_set_transaction("nol", 0, 0);
    expect(transactions()).toEqual([
      expect.objectContaining({ name: "manual", status: "Fail", durationMs: 1500, iteration: 1 }),
      expect.objectContaining({ name: "manual2", status: "Pass", durationMs: 250 }),
      expect.objectContaining({ name: "kecil", status: "Pass", durationMs: 4.2 }),
      expect.objectContaining({ name: "nol", status: "Pass", durationMs: 0 }),
    ]);
    expect(api.lr_get_transaction_status("manual")).toBe(1);
  });
});

describe("lr_end_timer (detik) + lr_set_transaction", () => {
  it("lr_end_timer mengembalikan detik; dipakai langsung di lr_set_transaction", async () => {
    const handle = api.lr_start_timer();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const seconds = api.lr_end_timer(handle);
    expect(seconds).toBeGreaterThan(0.04);
    expect(seconds).toBeLessThan(1); // detik, bukan milidetik (60 ms ≈ 0.06)

    api.lr_set_transaction("diukur", seconds, 0);
    expect(transactions().at(-1).durationMs).toBeCloseTo(seconds * 1000, 2);
    expect(api.lr_end_timer(handle)).toBe(0); // handle sudah dipakai
  });
});

describe("R6 step gagal", () => {
  it("status 500: step.error terisi, transaksi gagal, lalu error dilempar", async () => {
    api.lr_start_transaction("T");
    await expect(api.web_url("rusak", `URL=${BASE}/status/500`, "LAST")).rejects.toThrow(/HTTP 500/);
    expect(steps()[0]).toMatchObject({ name: "rusak", error: expect.stringContaining("HTTP 500"), transaction: "T" });
    expect(steps()[0].response.status).toBe(500);
    expect(api.lr_get_transaction_status("T")).toBe(1);
  });

  it("continueOnError: step.error terisi, log error, fungsi mengembalikan LR_FAIL (1) dan script lanjut", async () => {
    env.ctx.runOptions.continueOnError = true;
    expect(await api.web_url("rusak", `URL=${BASE}/status/503`, "LAST")).toBe(1);
    expect(await api.web_url("ok", `URL=${BASE}/echo-headers`, "LAST")).toBe(0);
    expect(steps().map((s) => s.error !== null)).toEqual([true, false]);
    expect(env.logs.some(([level, msg]) => level === "error" && /gagal: HTTP 503/.test(msg))).toBe(true);
  });

  it("web_reg_find tidak terpenuhi -> step gagal", async () => {
    api.web_reg_find("Text=TidakAdaDiHalaman", "LAST");
    await expect(api.web_url("cari", `URL=${BASE}/echo-headers`, "LAST")).rejects.toThrow(/web_reg_find/);
    expect(steps()[0].checks).toEqual([expect.objectContaining({ passed: false })]);
    expect(steps()[0].error).toContain("TidakAdaDiHalaman");
  });

  it("web_reg_find terpenuhi -> step sukses", async () => {
    api.web_reg_find("Text=host", "LAST");
    expect(await api.web_url("cari", `URL=${BASE}/echo-headers`, "LAST")).toBe(0);
    expect(steps()[0].error).toBeNull();
  });

  it("koneksi ditolak: step dengan error (status 0) lalu error dilempar", async () => {
    await expect(api.web_url("mati", "URL=http://127.0.0.1:1/x", "LAST")).rejects.toThrow(/web_url "mati"/);
    expect(steps()[0]).toMatchObject({ name: "mati", error: expect.any(String) });
    expect(steps()[0].response.status).toBe(0);
    expect(steps()[0].request.url).toBe("http://127.0.0.1:1/x");
  });

  it("timeout: pesan jelas, step error", async () => {
    env.ctx.runOptions.timeoutMs = 300;
    env.ctx.runOptions.continueOnError = true;
    expect(await api.web_url("lambat", `URL=${BASE}/slow`, "LAST")).toBe(1);
    expect(steps()[0].error).toMatch(/timeout setelah 300 ms/);
  }, 10000);

  it("registry reg_* dibersihkan setelah request gagal (tidak bocor ke request berikutnya)", async () => {
    env.ctx.runOptions.continueOnError = true;
    api.web_reg_find("Text=TidakAda", "LAST");
    await api.web_url("mati", "URL=http://127.0.0.1:1/x", "LAST");
    expect(await api.web_url("ok", `URL=${BASE}/echo-headers`, "LAST")).toBe(0);
    expect(steps()[1].checks).toEqual([]);
  });
});

describe("R7 correlation regex", () => {
  it("RegExp tidak valid: error di log + step error, bukan crash", async () => {
    env.ctx.runOptions.continueOnError = true;
    api.web_reg_save_param_regexp("ParamName=bad", "RegExp=([unclosed", "Ord=1", "LAST");
    const result = await api.web_url("corr", `URL=${BASE}/echo-headers`, "LAST");
    expect(result).toBe(1);
    expect(steps()[0].error).toMatch(/Correlation "bad": RegExp tidak valid/);
    expect(env.ctx.params.has("bad")).toBe(false);
  });

  it("RegExp valid mengisi parameter", async () => {
    api.web_reg_save_param_regexp("ParamName=host", 'RegExp="host":"([^"]+)"', "Ord=1", "LAST");
    await api.web_url("corr", `URL=${BASE}/echo-headers`, "LAST");
    expect(env.ctx.params.get("host")).toBe("127.0.0.1:18083");
  });

  it("vuser-api tidak lagi punya default export", async () => {
    expect(Object.keys(await import("../runtime/vuser-api.js"))).not.toContain("default");
  });
});

describe("R8 http-client", () => {
  it("durationMs > 0 dan request asli tercatat (termasuk Cookie dari jar)", async () => {
    const client = new HttpClient({ timeoutMs: 5000 });
    clients.push(client);
    await client.addCookie("k=v; Path=/", `${BASE}/`);
    const resp = await client.doRequest({ method: "GET", url: `${BASE}/echo-headers`, headers: { "X-Test": "1" } });
    expect(resp.durationMs).toBeGreaterThan(0);
    expect(resp.startedAt).toBeLessThanOrEqual(Date.now());
    expect(resp.request).toMatchObject({ method: "GET", url: `${BASE}/echo-headers` });
    expect(resp.request.headers).toMatchObject({ "X-Test": "1", Cookie: "k=v" });
  });

  it("redirect dicatat dan durasi mencakup seluruh rantai", async () => {
    const client = new HttpClient({ timeoutMs: 5000 });
    clients.push(client);
    const resp = await client.doRequest({ method: "GET", url: `${BASE}/logout`, followRedirects: true });
    expect(resp.redirectChain).toHaveLength(1);
    expect(resp.redirectChain[0]).toMatchObject({ status: 302 });
  });

  it("timeoutMs per request mengalahkan default client", async () => {
    const client = new HttpClient({ timeoutMs: 60000 });
    clients.push(client);
    await expect(client.doRequest({ method: "GET", url: `${BASE}/slow`, timeoutMs: 200 })).rejects.toThrow();
  }, 10000);

  it("addCookie mengembalikan { ok:false, error } untuk cookie yang ditolak", async () => {
    const client = new HttpClient();
    clients.push(client);
    expect(await client.addCookie("a=1; Domain=lain.example", `${BASE}/`)).toMatchObject({ ok: false, error: expect.any(String) });
    expect(await client.addCookie("a=1", `${BASE}/`)).toEqual({ ok: true });
  });

  it("kode mati dihapus: setCookieJar/getCookieJar/cleanupCookies", () => {
    const client = new HttpClient();
    clients.push(client);
    for (const name of ["setCookieJar", "getCookieJar", "cleanupCookies"]) expect(client[name]).toBeUndefined();
  });

  it("debugCallback menerima log request (dipakai runner untuk menyertakan file/line)", async () => {
    const lines = [];
    const client = new HttpClient({ debugCallback: (level, msg) => lines.push([level, msg]) });
    clients.push(client);
    await client.doRequest({ method: "GET", url: `${BASE}/echo-headers` });
    expect(lines.map(([, msg]) => msg).join("\n")).toMatch(/GET .*\/echo-headers -> 200/);
  });
});

describe("R8 insecureTLS (server HTTPS self-signed lokal)", () => {
  let server;
  let url;
  let available = false;

  beforeAll(async () => {
    try {
      const dir = await fs.mkdtemp(path.join(tmpDir, "tls-"));
      const key = path.join(dir, "key.pem");
      const cert = path.join(dir, "cert.pem");
      execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
      if (!existsSync(cert)) return;
      server = createServer({ key: await fs.readFile(key), cert: await fs.readFile(cert) }, (_req, res) => res.end("secure ok"));
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      url = `https://127.0.0.1:${server.address().port}/`;
      available = true;
    } catch {
      available = false; // openssl tidak tersedia: test di-skip
    }
  });

  afterAll(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("insecureTLS=false menolak sertifikat self-signed; true menerima", async (ctx) => {
    if (!available) return ctx.skip();
    const strict = new HttpClient({ insecureTLS: false });
    const loose = new HttpClient({ insecureTLS: true });
    clients.push(strict, loose);

    await expect(strict.doRequest({ method: "GET", url })).rejects.toThrow();
    const resp = await loose.doRequest({ method: "GET", url });
    expect(resp.status).toBe(200);
    expect(resp.body.toString()).toBe("secure ok");
  });
});

describe("F7c web_remove_auto_header / web_revert_auto_header", () => {
  it("web_remove_auto_header(name, LAST): header hilang dari request berikutnya, header lain tetap; nama case-insensitive", async () => {
    api.web_add_auto_header("Accept-Language", "id-ID");
    api.web_add_auto_header("X-Keep", "tetap");
    expect(api.web_remove_auto_header("accept-LANGUAGE", "LAST")).toBe(0);

    await api.web_url("cek", `URL=${BASE}/echo-headers`, "LAST");
    const headers = steps()[0].request.headers;
    expect(headers["accept-language"]).toBeUndefined();
    expect(headers["x-keep"]).toBe("tetap");
  });

  it("web_revert_auto_header(name): sama — header dicabut dari auto header", async () => {
    api.web_add_auto_header("Device-Id", "abc");
    expect(api.web_revert_auto_header("Device-Id")).toBe(0);
    await api.web_url("cek", `URL=${BASE}/echo-headers`, "LAST");
    expect(steps()[0].request.headers["device-id"]).toBeUndefined();
  });

  it("header yang tidak ada: tidak error; bisa ditambahkan lagi sesudahnya", async () => {
    expect(api.web_revert_auto_header("Tidak-Ada")).toBe(0);
    api.web_add_auto_header("X-A", "1");
    api.web_remove_auto_header("X-A", "LAST");
    api.web_add_auto_header("X-A", "2");
    await api.web_url("cek", `URL=${BASE}/echo-headers`, "LAST");
    expect(steps()[0].request.headers["x-a"]).toBe("2");
  });

  it("ImplicitGen= (pola KOPRA) diabaikan dengan warning; header tetap dihapus", async () => {
    api.web_add_auto_header("X-Implicit", "1");
    api.web_remove_auto_header("X-Implicit", "ImplicitGen=Yes", "LAST");
    expect(env.logs.some(([level, msg]) => level === "warn" && /ImplicitGen/.test(msg))).toBe(true);
    await api.web_url("cek", `URL=${BASE}/echo-headers`, "LAST");
    expect(steps()[0].request.headers["x-implicit"]).toBeUndefined();
  });

  it("header sekali pakai (web_add_header) tidak ikut terhapus", async () => {
    api.web_add_header("X-Once", "1");
    api.web_remove_auto_header("X-Once", "LAST");
    await api.web_url("cek", `URL=${BASE}/echo-headers`, "LAST");
    expect(steps()[0].request.headers["x-once"]).toBe("1");
  });
});

describe("F7c lr_param_sprintf + web_convert_from_formatted", () => {
  it("lr_param_sprintf menyimpan hasil printf ke parameter (pola KOPRA: user:password)", () => {
    env.ctx.params.set("username", "user");
    env.ctx.params.set("password", "pass");
    expect(api.lr_param_sprintf("usernamePassword", "%s", api.lr_eval_string("{username}:{password}"))).toBe(0);
    expect(env.ctx.params.get("usernamePassword")).toBe("user:pass");
  });

  it("lr_param_sprintf: format lengkap dan argumen banyak", () => {
    api.lr_param_sprintf("kode", "%s-%04d-%.1f%%", "ID", 42, 99.95);
    expect(env.ctx.params.get("kode")).toBe("ID-0042-100.0%");
  });

  it("web_convert_from_formatted Extensions=Base64: 'user:pass' -> dXNlcjpwYXNz", () => {
    env.ctx.params.set("usernamePassword", "user:pass");
    expect(api.web_convert_from_formatted("FormattedData={usernamePassword}", "TargetParam=basicUsername", "Extensions=Base64", "LAST")).toBe(0);
    expect(env.ctx.params.get("basicUsername")).toBe("dXNlcjpwYXNz");
  });

  it("pipeline lengkap pola KOPRA: lr_param_sprintf -> Base64 -> Authorization: Basic {basicUsername}", async () => {
    env.ctx.params.set("username", "user");
    env.ctx.params.set("password", "pass");
    api.lr_param_sprintf("usernamePassword", "%s", api.lr_eval_string("{username}:{password}"));
    api.web_convert_from_formatted("FormattedData={usernamePassword}", "TargetParam=basicUsername", "Extensions=Base64", "LAST");
    api.web_add_header("Authorization", "Basic {basicUsername}");
    await api.web_url("auth", `URL=${BASE}/echo-headers`, "LAST");
    expect(steps()[0].request.headers.authorization).toBe("Basic dXNlcjpwYXNz");
  });

  it("Base64 memakai UTF-8 dan nilai kosong", () => {
    env.ctx.params.set("teks", "é€");
    api.web_convert_from_formatted("FormattedData={teks}", "TargetParam=b", "Extensions=base64", "LAST");
    expect(env.ctx.params.get("b")).toBe(Buffer.from("é€", "utf8").toString("base64"));
    api.web_convert_from_formatted("FormattedData=", "TargetParam=kosong", "Extensions=Base64", "LAST");
    expect(env.ctx.params.get("kosong")).toBe("");
  });

  it("Extensions lain: warning, parameter tidak diisi, return 1 (tanpa melempar)", () => {
    expect(api.web_convert_from_formatted("FormattedData=abc", "TargetParam=x", "Extensions=Hex", "LAST")).toBe(1);
    expect(env.ctx.params.has("x")).toBe(false);
    expect(env.logs.some(([level, msg]) => level === "warn" && /Hex/.test(msg))).toBe(true);
  });

  it("tanpa Extensions: warning, tidak diisi", () => {
    expect(api.web_convert_from_formatted("FormattedData=abc", "TargetParam=y", "LAST")).toBe(1);
    expect(env.ctx.params.has("y")).toBe(false);
  });

  it("FormattedData / TargetParam wajib", () => {
    expect(() => api.web_convert_from_formatted("TargetParam=x", "Extensions=Base64", "LAST")).toThrow(/FormattedData/);
    expect(() => api.web_convert_from_formatted("FormattedData=a", "Extensions=Base64", "LAST")).toThrow(/TargetParam/);
  });
});
