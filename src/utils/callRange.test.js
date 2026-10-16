import { describe, expect, it } from "vitest";

import { callEndLine } from "./callRange.js";

const SOURCE = [
  /* 1 */ "Loadpage(char* parentTrans)",
  /* 2 */ "{",
  /* 3 */ "\tstartTime = lr_start_timer();",
  /* 4 */ '\tweb_custom_request(lr_eval_string("RPS_{subTrans}_01_ui"),',
  /* 5 */ '\t        "URL=https://{ip}/a/b",',
  /* 6 */ '\t        "Body={\\"x\\":\\"LAST);\\"}",', // string berisi kutip ter-escape dan "LAST);"
  /* 7 */ "\t        // komentar dengan kurung ) dan LAST);",
  /* 8 */ "\t        /* blok ) di baris pertama",
  /* 9 */ "\t           dan baris kedua komentar */",
  /* 10 */ "\t        LAST);",
  /* 11 */ "\ttempSeq = lr_end_timer(startTime);",
  /* 12 */ '\tweb_url("home", "URL=http://x/", LAST);',
  /* 13 */ "\treturn 0;",
  /* 14 */ "}",
].join("\n");

describe("callEndLine", () => {
  it("pemanggilan multi-baris: dari web_custom_request( sampai LAST);", () => {
    expect(callEndLine(SOURCE, 4)).toBe(10);
  });

  it("pemanggilan satu baris", () => {
    expect(callEndLine(SOURCE, 12)).toBe(12);
    expect(callEndLine(SOURCE, 3)).toBe(3);
    expect(callEndLine(SOURCE, 11)).toBe(11);
  });

  it("kurung di string, karakter, dan komentar diabaikan", () => {
    expect(callEndLine('a(")", \')\', /* ) */ 1); // )\nb();', 1)).toBe(1);
  });

  it("CRLF sama dengan LF", () => {
    expect(callEndLine(SOURCE.replace(/\n/g, "\r\n"), 4)).toBe(10);
  });

  it("bukan pemanggilan fungsi / tidak seimbang / di luar file -> startLine", () => {
    expect(callEndLine(SOURCE, 2)).toBe(2); // "{"
    expect(callEndLine(SOURCE, 13)).toBe(13); // return 0;
    expect(callEndLine("foo(1, 2", 1)).toBe(1);
    expect(callEndLine("a();", 5)).toBe(5);
  });

  it("pemanggilan bersarang: kurung terluar menentukan akhir", () => {
    const text = "x(\n  y(\n    z(1)\n  ),\n  2\n);\nnext();";
    expect(callEndLine(text, 1)).toBe(6);
    expect(callEndLine(text, 2)).toBe(4);
  });
});
