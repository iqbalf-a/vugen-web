/**
 * Test panel Parameter: event step membawa perubahan parameter VuGen (`params`) dan variabel C (`vars`).
 * Mock di port 18089.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { startRun } from "../runs/execute.js";
import { startMockServer, stopMockServer } from "./mock.js";

let base;
let previousCache;
/** @type {import("../runs/store.js").RunResult} */
let result;

beforeAll(async () => {
  previousCache = process.env.VUGEN_CACHE_DIR;
  base = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-vars-"));
  process.env.VUGEN_CACHE_DIR = path.join(base, "cache");
  await startMockServer(18089);

  const dir = path.join(base, "script");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "ip.dat"), "ip\r\n127.0.0.1\r\n", "utf8");
  await fs.writeFile(path.join(dir, "vuser_init.c"), "vuser_init()\r\n{\r\n    return 0;\r\n}\r\n", "utf8");
  await fs.writeFile(path.join(dir, "vuser_end.c"), "vuser_end()\r\n{\r\n    return 0;\r\n}\r\n", "utf8");
  await fs.writeFile(
    path.join(dir, "Action.c"),
    [
      "int i = 5;",
      "double ratio = 1.5;",
      "",
      "Action()",
      "{",
      "    int count = 0;",
      '    char *nama = "demo";',
      "    char buf[16];",
      "",
      '    lr_save_string("T1", "transName");',
      '    web_url("a", "URL=http://{ip}:18089/json", LAST);',
      "",
      '    lr_save_string("T2", "transName");',
      '    lr_save_string("T3", "transName");',
      '    web_reg_save_param_json("ParamName=tok", "QueryString=$..token", LAST);',
      '    web_reg_save_param("rid", "LB=\\"requestId\\":\\"", "RB=\\"", LAST);',
      "    count = 3;",
      '    web_url("b", "URL=http://{ip}:18089/json", LAST);',
      "    return 0;",
      "}",
      "",
    ].join("\r\n"),
    "utf8",
  );

  const run = await startRun({ scriptDir: dir, options: { iterations: 2 } });
  result = await run.done;
}, 30000);

afterAll(async () => {
  await stopMockServer();
  if (previousCache === undefined) delete process.env.VUGEN_CACHE_DIR;
  else process.env.VUGEN_CACHE_DIR = previousCache;
  await fs.rm(base, { recursive: true, force: true });
});

const step = (name, iteration = 1) => result.steps.find((s) => s.name === name && s.iteration === iteration);
const change = (stepResult, name) => stepResult.params.find((p) => p.name === name);
const variable = (stepResult, name) => stepResult.vars.find((v) => v.name === name);

describe("params: perubahan parameter VuGen per step", () => {
  it("run selesai", () => {
    expect(result.status).toBe("passed");
  });

  it("parameter dari .dat tercatat di step pertama dengan sumber file-nya", () => {
    expect(change(step("a"), "ip")).toMatchObject({ value: "127.0.0.1", source: ".dat: ip.dat" });
  });

  it("lr_save_string: sumber, file, dan baris pemanggilan", () => {
    expect(change(step("a"), "transName")).toEqual({ name: "transName", value: "T1", source: "lr_save_string", file: "Action.c", line: 10 });
  });

  it("nilai yang diisi berulang di antara dua step: hanya nilai terakhir; step berikutnya hanya membawa yang berubah", () => {
    const b = step("b");
    expect(change(b, "transName")).toMatchObject({ value: "T3", source: "lr_save_string" });
    expect(change(b, "ip")).toBeUndefined(); // tidak berubah sejak step a
  });

  it("web_reg_save_param_json dan web_reg_save_param (boundary) tercatat dengan sumbernya", () => {
    const b = step("b");
    expect(change(b, "tok")).toMatchObject({ value: "tok-123", source: "web_reg_save_param_json (JSONPath)" });
    expect(change(b, "rid")).toMatchObject({ value: "R-77", source: "web_reg_save_param (boundary)" });
  });

  it("iterasi berikutnya: parameter .dat dicatat lagi saat baris maju (walau nilainya sama)", () => {
    expect(change(step("a", 2), "ip")).toMatchObject({ value: "127.0.0.1", source: ".dat: ip.dat" });
  });

  it("menerapkan perubahan berurutan menghasilkan nilai akhir run (params)", () => {
    const state = {};
    for (const s of result.steps) for (const c of s.params) state[c.name] = c.removed ? undefined : c.value;
    for (const [name, value] of Object.entries(state)) expect(result.params[name], name).toBe(value);
  });
});

describe("vars: variabel C pada baris step", () => {
  it("lokal (int, double, char*, char[N]) dan global terlihat dengan tipe dan nilai pada saat step", () => {
    const a = step("a");
    expect(variable(a, "count")).toEqual({ name: "count", type: "int", value: "0" });
    expect(variable(a, "nama")).toEqual({ name: "nama", type: "char*", value: "demo" });
    expect(variable(a, "buf")).toEqual({ name: "buf", type: "char[16]", value: "" });
    expect(variable(a, "i")).toEqual({ name: "i", type: "int", value: "5" });
    expect(variable(a, "ratio")).toEqual({ name: "ratio", type: "double", value: "1.5" });
  });

  it("nilai berubah antar step (count 0 -> 3)", () => {
    expect(variable(step("a"), "count").value).toBe("0");
    expect(variable(step("b"), "count").value).toBe("3");
  });

  it("step iterasi 2 menunjukkan variabel lokal baru (count kembali 0)", () => {
    expect(variable(step("a", 2), "count").value).toBe("0");
  });
});
