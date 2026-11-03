import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  RUNTIME_DEFAULTS,
  parseRuntimeSettings,
  readRuntimeSettings,
  setIniKeys,
  updateRuntimeSettings,
} from "./runtimeSettings.js";

const CFG = [
  "[General]",
  "ContinueOnError=1",
  "ConnectTimeout=5",
  "",
  "[WEB]",
  "BrowserType=Microsoft Internet Explorer 4.0",
  "ConnectTimeout=600",
  "HttpErrorsAsWarnings=0",
  "KeepAlive=1",
  "KeepAliveTimeout=600",
  "PageDownloadTimeout=600",
  "ReceiveTimeout=600",
  "ProxyBypass=10.*;localhost",
  "",
  "[FILTERS]",
  "FilterType=1",
  "",
].join("\r\n");

describe("parseRuntimeSettings", () => {
  it("membaca timeout & HttpErrorsAsWarnings dari [WEB] (bukan section lain)", () => {
    expect(parseRuntimeSettings(CFG)).toEqual({
      connectTimeout: 600,
      receiveTimeout: 600,
      keepAliveTimeout: 600,
      pageDownloadTimeout: 600,
      httpErrorsAsWarnings: false,
    });
  });

  it("key tidak ada / tidak valid -> default VuGen", () => {
    expect(parseRuntimeSettings("[WEB]\nConnectTimeout=abc\n")).toEqual(RUNTIME_DEFAULTS);
    expect(parseRuntimeSettings("")).toEqual(RUNTIME_DEFAULTS);
  });

  it("HttpErrorsAsWarnings=1 -> true; section & key case-insensitive", () => {
    expect(parseRuntimeSettings("[web]\nhttperrorsaswarnings=1\n").httpErrorsAsWarnings).toBe(true);
  });
});

describe("setIniKeys", () => {
  it("hanya mengubah baris target, EOL CRLF dan section lain tetap", () => {
    const next = setIniKeys(CFG, "WEB", { ConnectTimeout: "30", HttpErrorsAsWarnings: "1" });
    expect(next).toContain("[WEB]\r\nBrowserType=Microsoft Internet Explorer 4.0\r\nConnectTimeout=30\r\nHttpErrorsAsWarnings=1\r\n");
    expect(next).toContain("[General]\r\nContinueOnError=1\r\nConnectTimeout=5\r\n"); // General tidak tersentuh
    expect(next.split("\r\n").length).toBe(CFG.split("\r\n").length);
    expect(next.replace(/\r\n/g, "\n")).not.toContain("\n\n\n");
  });

  it("key yang belum ada ditambahkan di akhir section, sebelum section berikutnya", () => {
    const next = setIniKeys("[WEB]\nA=1\n\n[FILTERS]\nB=2\n", "WEB", { ReceiveTimeout: "45" });
    expect(next).toBe("[WEB]\nA=1\nReceiveTimeout=45\n\n[FILTERS]\nB=2\n");
  });

  it("section belum ada -> dibuat", () => {
    expect(setIniKeys("[General]\nA=1\n", "WEB", { ConnectTimeout: "9" })).toBe("[General]\nA=1\n\n[WEB]\nConnectTimeout=9\n");
    expect(setIniKeys("", "WEB", { ConnectTimeout: "9" })).toBe("[WEB]\nConnectTimeout=9\n");
  });
});

describe("updateRuntimeSettings (file)", () => {
  let dir;
  let cache;
  let previousCache;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-rts-"));
    cache = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-rts-cache-"));
    previousCache = process.env.VUGEN_CACHE_DIR;
    process.env.VUGEN_CACHE_DIR = cache;
  });
  afterEach(async () => {
    if (previousCache === undefined) delete process.env.VUGEN_CACHE_DIR;
    else process.env.VUGEN_CACHE_DIR = previousCache;
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(cache, { recursive: true, force: true });
  });

  it("tanpa default.cfg: readRuntimeSettings = default, file null", async () => {
    expect(await readRuntimeSettings(dir)).toEqual({ ...RUNTIME_DEFAULTS, file: null });
  });

  it("menulis default.cfg yang ada (nama case-insensitive), membuat backup, byte lain tetap", async () => {
    await fs.writeFile(path.join(dir, "Default.cfg"), Buffer.from(CFG, "latin1"));
    const result = await updateRuntimeSettings(dir, { connectTimeout: 30, httpErrorsAsWarnings: true });
    expect(result).toMatchObject({ file: "Default.cfg", connectTimeout: 30, httpErrorsAsWarnings: true, receiveTimeout: 600 });
    const written = (await fs.readFile(path.join(dir, "Default.cfg"))).toString("latin1");
    expect(written).toBe(CFG.replace("ConnectTimeout=600", "ConnectTimeout=30").replace("HttpErrorsAsWarnings=0", "HttpErrorsAsWarnings=1"));
    const backups = await fs.readdir(path.join(cache, (await fs.readdir(cache))[0], "backups"));
    expect(backups).toHaveLength(1);
  });

  it("membuat default.cfg minimal bila belum ada", async () => {
    const result = await updateRuntimeSettings(dir, { receiveTimeout: 45 });
    expect(result).toMatchObject({ file: "default.cfg", receiveTimeout: 45 });
    expect(await fs.readFile(path.join(dir, "default.cfg"), "utf8")).toBe("[WEB]\nReceiveTimeout=45\n");
  });

  it("validasi: nilai bukan bilangan bulat 1..86400, key asing, tipe salah -> 400", async () => {
    await expect(updateRuntimeSettings(dir, { connectTimeout: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(updateRuntimeSettings(dir, { connectTimeout: 1.5 })).rejects.toMatchObject({ status: 400 });
    await expect(updateRuntimeSettings(dir, { connectTimeout: 99999 })).rejects.toMatchObject({ status: 400 });
    await expect(updateRuntimeSettings(dir, { bogus: 1 })).rejects.toMatchObject({ status: 400 });
    await expect(updateRuntimeSettings(dir, { httpErrorsAsWarnings: "1" })).rejects.toMatchObject({ status: 400 });
    await expect(updateRuntimeSettings(dir, {})).rejects.toMatchObject({ status: 400 });
  });
});
