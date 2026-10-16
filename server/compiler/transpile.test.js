import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sprintf, strcmp, strcpy } from "../runtime/vuser-api.js";
import { TRANSPILE_SETS, compilerDir, fixtureNames, jsGoldenPath, transpileFixtureFiles } from "./test-utils.js";

let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vugen-transpile-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Tulis kode hasil transpile ke temp dir (.mjs) lalu import() — memastikan sintaks JS valid. */
async function importCode(name, code) {
  const target = path.join(tmpDir, `${name}.mjs`);
  fs.writeFileSync(target, code, "utf8");
  return import(pathToFileURL(target).href);
}

/**
 * `__vu` palsu: fungsi yang tidak dikenal dicatat lalu mengembalikan 0.
 * Fungsi C murni (sprintf, strcmp, strcpy) memakai implementasi asli.
 */
function makeVu(overrides = {}) {
  const calls = [];
  const unsupported = [];
  const impl = {
    __at() {},
    __unsupported: (raw) => unsupported.push(`stmt:${raw}`),
    __unsupportedCall: (name) => unsupported.push(name),
    lr_eval_string: (s) => s,
    sprintf,
    strcmp,
    strcpy,
    ...overrides,
  };
  const vu = new Proxy(impl, {
    get(target, prop) {
      if (prop in target) {
        return (...args) => {
          calls.push([String(prop), ...args]);
          return target[prop](...args);
        };
      }
      return (...args) => {
        calls.push([String(prop), ...args]);
        return 0;
      };
    },
  });
  return { vu, calls, unsupported };
}

describe("transpile: golden JS", () => {
  for (const [name, files] of Object.entries(TRANSPILE_SETS)) {
    it(`cocok dengan ${name}.js.golden`, async () => {
      const { code } = await transpileFixtureFiles(files);
      // EOL-agnostik: checkout Windows (autocrlf) boleh mengubah golden menjadi CRLF
      expect(code).toBe(fs.readFileSync(jsGoldenPath(name), "utf8").replaceAll("\r\n", "\n"));
    });
  }
});

describe("transpile: hasil transpile valid secara sintaks (import)", () => {
  for (const name of fixtureNames()) {
    it(`fixture ${name}.c`, async () => {
      const { code } = await transpileFixtureFiles([`${name}.c`]);
      const mod = await importCode(`single-${name}`, code);
      expect(typeof mod.__bind).toBe("function");
    });
  }

  for (const [name, files] of Object.entries(TRANSPILE_SETS)) {
    it(`set ${name}`, async () => {
      const { code } = await transpileFixtureFiles(files);
      const mod = await importCode(`set-${name}`, code);
      expect(typeof mod.__bind).toBe("function");
    });
  }
});

describe("transpile: pola KOPRA (kopra-loadpage)", () => {
  async function load() {
    const result = await transpileFixtureFiles(TRANSPILE_SETS["kopra-loadpage"]);
    const mod = await importCode("kopra-behaviour", result.code);
    return { result, mod };
  }

  it("tidak ada hardcode startTime di transpiler; global dari globals.h jadi variabel modul", async () => {
    const source = fs.readFileSync(path.join(compilerDir, "transpile.js"), "utf8");
    expect(source).not.toMatch(/startTime/);

    const { code } = await transpileFixtureFiles(TRANSPILE_SETS["kopra-loadpage"]);
    expect(code).toMatch(/^let startTime = 0;$/m);
    expect(code).toMatch(/^let retryLimit = 3, retryCount = 0;$/m);
    expect(code).toMatch(/^let lastError = "";$/m);
  });

  it("tidak ada warning untuk fungsi yang didukung runtime (lr_start_timer, web_js_run, ...)", async () => {
    const { result } = await load();
    const messages = result.warnings.map((w) => w.message);
    expect(messages.filter((m) => /lr_start_timer|lr_end_timer|web_js_run|web_set_sockets_option|web_set_max_html_param_len|compareDuration/.test(m))).toEqual([]);
    // hanya lr_exit yang belum didukung (backlog)
    expect(messages.filter((m) => /belum didukung/.test(m))).toEqual([expect.stringContaining("lr_exit")]);
  });

  it("fungsi user mengembalikan nilai (compareDuration)", async () => {
    const { mod } = await load();
    const { vu } = makeVu();
    mod.__bind(vu);
    expect(await mod.__fn_compareDuration(1, 5)).toBe(5);
    expect(await mod.__fn_compareDuration(9, 5)).toBe(9);
  });

  it("makro status berupa angka: LR_FAIL (1) cocok dengan lr_get_transaction_status", async () => {
    const { mod } = await load();
    let timer = 0;
    const { vu, calls, unsupported } = makeVu({
      lr_get_transaction_status: () => 1,
      lr_start_timer: () => ++timer,
      lr_end_timer: () => 5,
    });
    mod.__bind(vu);

    await mod.__fn_Loadpage("PARENT");

    // cabang `== LR_FAIL` dimasuki: error dicatat, lr_exit (belum didukung) lewat unsupported
    expect(calls.find((c) => c[0] === "lr_error_message")).toEqual(["lr_error_message", "transaksi gagal: %s", "{transName}"]);
    expect(unsupported).toEqual(["lr_exit"]);
    // seq1 = compareDuration(0, 5) = 5 -> totalSeq = 5; status = 1
    expect(calls.find((c) => c[0] === "lr_set_transaction").slice(2)).toEqual([5, 1]);
    // makro argumen web tetap sentinel string
    const jsRun = calls.find((c) => c[0] === "web_js_run");
    expect(jsRun).toContain("SOURCES");
    expect(jsRun.at(-1)).toBe("LAST");
  });

  it("makro status lain bernilai angka dan makro argumen tetap string", async () => {
    const { code } = await transpileFixtureFiles(TRANSPILE_SETS["kopra-loadpage"]);
    expect(code).toMatch(/\bLR_FAIL\b/.test(code) ? /$^/ : /\(\w+ == 1\)|== 1\)/);
    expect(code).toContain('"LAST"');
    expect(code).toContain('"SOURCES"');
    expect(code).toContain('"ENDITEM"');
  });
});

describe("transpile: kasus umum (transpile-cases)", () => {
  async function load() {
    const result = await transpileFixtureFiles(TRANSPILE_SETS["transpile-cases"]);
    const mod = await importCode("cases-behaviour", result.code);
    return { result, mod };
  }

  it("strcpy/sprintf menjadi assignment ke buffer; strcat belum didukung -> warning", async () => {
    const { result, mod } = await load();
    const { vu, calls, unsupported } = makeVu();
    mod.__bind(vu);

    const ret = await mod.__fn_Action();

    // cast (int)3.7 -> 3 ; sprintf(buf, "%d-%s", 3, "teks") -> buf = "3-teks"
    expect(calls.filter((c) => c[0] === "lr_output_message").map((c) => c[1])).toContain("3-teks");
    expect(result.warnings.some((w) => /strcat/.test(w.message))).toBe(true);
    expect(result.warnings.some((w) => /unknown_function/.test(w.message))).toBe(true);
    expect(unsupported).toContain("strcat");
    expect(unsupported).toContain("unknown_function");
    // do-while menghitung mundur ke 0 -> switch case 0 -> return count + 1
    expect(ret).toBe(1);
    expect(calls.filter((c) => c[0] === "lr_think_time").map((c) => c[1])).toEqual([1]);
  });

  it("blok bersarang dengan variabel sama tidak bentrok; nama reserved JS aman", async () => {
    const { mod } = await load();
    const { vu, calls } = makeVu();
    mod.__bind(vu);
    await mod.__fn_Action();
    const printed = calls.filter((c) => c[0] === "lr_output_message" && c[1] === "%d").map((c) => c[2]);
    expect(printed).toEqual([3, 5]);
  });

  it("switch: case/default/break", async () => {
    const { mod } = await load();
    const { vu, calls } = makeVu();
    mod.__bind(vu);
    await mod.__fn_Action();
    const msgs = calls.filter((c) => c[0] === "lr_output_message").map((c) => c[1]);
    expect(msgs).toContain("nol");
    expect(msgs).not.toContain("lain");
  });
});
