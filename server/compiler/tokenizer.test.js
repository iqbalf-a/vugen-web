import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { fixtureNames, goldenPath, readFixture, simplifyTokens } from "./test-utils.js";
import { tokenize } from "./tokenizer.js";

describe("tokenizer: golden file", () => {
  for (const name of fixtureNames()) {
    it(`cocok dengan ${name}.tokens.json`, () => {
      const golden = JSON.parse(fs.readFileSync(goldenPath(name, "tokens"), "utf8"));
      expect(golden.file).toBe(`${name}.c`);
      expect(simplifyTokens(tokenize(readFixture(name)).tokens)).toEqual(golden.tokens);
    });
  }
});

describe("tokenizer: string literal & escape", () => {
  it("meng-decode escape kutip, backslash, newline, dan hex", () => {
    const source = String.raw`lr_output_message("a\"b\\c\n\x41");`;
    const { tokens, warnings } = tokenize(source);
    const string = tokens.find((token) => token.type === "string");

    expect(warnings).toEqual([]);
    expect(string.value).toBe('a"b\\c\nA');
  });

  it("menggabungkan literal yang bersebelahan walau ada komentar di antaranya", () => {
    const { tokens } = tokenize('"a" /* sisipan */ "b" "c"');
    const strings = tokens.filter((token) => token.type === "string");

    expect(strings).toHaveLength(1);
    expect(strings[0].value).toBe("abc");
  });

  it("golden tetap sama bila fixture dikonversi ke CRLF", () => {
    for (const name of fixtureNames()) {
      const golden = JSON.parse(fs.readFileSync(goldenPath(name, "tokens"), "utf8"));
      const crlf = readFixture(name).replace(/\r?\n/g, "\r\n");
      expect(simplifyTokens(tokenize(crlf).tokens), name).toEqual(golden.tokens);
    }
  });

  it("memberi warning bila string tidak ditutup", () => {
    const { tokens, warnings } = tokenize('"tidak ditutup');

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/tidak ditutup/i);
    expect(tokens[0].value).toBe("tidak ditutup");
  });

  it("membaca char literal", () => {
    const { tokens } = tokenize("'a'");
    expect(tokens[0]).toMatchObject({ type: "char", value: "a" });
  });
});

describe("tokenizer: komentar & baris", () => {
  it("mengabaikan komentar kosong", () => {
    const { tokens } = tokenize("// baris\n/* blok */\n\n");
    expect(tokens.map((token) => token.type)).toEqual(["eof"]);
  });

  it("menghitung baris melewati komentar blok multi-baris", () => {
    const { tokens } = tokenize("int a;\n/* x\ny\nz */\nint b;");
    const identifier = tokens.filter((token) => token.type === "identifier");
    expect(identifier.map((token) => token.value)).toEqual(["int", "a", "int", "b"]);
    expect(identifier[3].line).toBe(5);
  });

  it("menangani CRLF", () => {
    const { tokens } = tokenize("alpha\r\nbeta");
    expect(tokens[0]).toMatchObject({ value: "alpha", line: 1 });
    expect(tokens[1]).toMatchObject({ value: "beta", line: 2 });
  });
});

describe("tokenizer: direktif, angka, dan makro", () => {
  it("membaca direktif preprocessor sebagai satu token", () => {
    const { tokens } = tokenize('#include "globals.h"\nAction()');
    expect(tokens[0]).toMatchObject({ type: "directive", value: 'include "globals.h"', line: 1 });
    expect(tokens[1]).toMatchObject({ type: "identifier", value: "Action" });
  });

  it("menggabungkan baris lanjutan pada direktif", () => {
    const { tokens } = tokenize("#define WIDE 1 + \\\n    2\n");
    expect(tokens[0].type).toBe("directive");
    expect(tokens[0].value).toContain("define WIDE");
    expect(tokens[0].value).toContain("1 +");
    expect(tokens[0].value).toContain("2");
    expect(tokens[1].type).toBe("eof");
  });

  it("tidak salah membuang digit hex sebagai sufiks", () => {
    const { tokens } = tokenize("0x1F 10UL 1.5f");
    expect(tokens.slice(0, 3).map((token) => token.value)).toEqual(["0x1F", "10", "1.5"]);
    expect(tokens.every((token) => token.type !== "identifier")).toBe(true);
  });

  it("mempertahankan makro VuGen sebagai identifier", () => {
    const { tokens } = tokenize('web_url("u", LAST); web_reg_save_param("p", ITEMDATA, ENDITEM, EXTRARES);');
    const identifiers = tokens.filter((token) => token.type === "identifier").map((token) => token.value);
    expect(identifiers).toContain("LAST");
    expect(identifiers).toContain("ITEMDATA");
    expect(identifiers).toContain("ENDITEM");
    expect(identifiers).toContain("EXTRARES");
  });
});
