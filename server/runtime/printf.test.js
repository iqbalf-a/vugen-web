import { describe, expect, it } from "vitest";

import { formatPrintf } from "./printf.js";

/** [format, args, hasil yang sama dengan C printf] */
const CASES = [
  // literal & %%
  ["tanpa spesifikasi", [], "tanpa spesifikasi"],
  ["100%%", [], "100%"],
  ["%%s %s", ["x"], "%s x"],
  ["%d%%", [50], "50%"],
  ["%%%d%%", [7], "%7%"],
  // %s
  ["%s", ["abc"], "abc"],
  ["[%5s]", ["ab"], "[   ab]"],
  ["[%-5s]", ["ab"], "[ab   ]"],
  ["[%.2s]", ["abcdef"], "[ab]"],
  ["[%6.3s]", ["abcdef"], "[   abc]"],
  ["[%s]", [undefined], "[]"],
  ["[%2s]", ["panjang"], "[panjang]"],
  // %d / %i
  ["%d", [42], "42"],
  ["%i", [-7], "-7"],
  ["%d", ["12"], "12"],
  ["%d", [3.9], "3"],
  ["%d", [-3.9], "-3"],
  ["%d", ["abc"], "0"],
  ["[%5d]", [42], "[   42]"],
  ["[%-5d]", [42], "[42   ]"],
  ["[%05d]", [42], "[00042]"],
  ["[%05d]", [-42], "[-0042]"],
  ["[%+d]", [5], "[+5]"],
  ["[% d]", [5], "[ 5]"],
  ["[%.3d]", [7], "[007]"],
  ["[%6.3d]", [7], "[   007]"],
  ["[%ld]", [123456789], "[123456789]"],
  ["[%lld]", [9], "[9]"],
  // %u %x %X %o
  ["%u", [42], "42"],
  ["%x", [255], "ff"],
  ["%X", [255], "FF"],
  ["%#x", [255], "0xff"],
  ["%o", [8], "10"],
  ["%08x", [48879], "0000beef"],
  // %f
  ["%f", [3.14159], "3.141590"],
  ["%.2f", [3.14159], "3.14"],
  ["%.0f", [2.6], "3"],
  ["%8.3f", [3.14159], "   3.142"],
  ["%08.3f", [-3.14159], "-003.142"],
  ["%-8.1f|", [2.26], "2.3     |"],
  ["%+.1f", [2], "+2.0"],
  ["%f", ["x"], "0.000000"],
  // %e
  ["%e", [12345.6789], "1.234568e+04"],
  ["%.2E", [0.000123], "1.23E-04"],
  // %g
  ["%g", [100000], "100000"],
  ["%g", [1000000], "1e+06"],
  ["%g", [0.0001], "0.0001"],
  ["%g", [0.00001], "1e-05"],
  ["%g", [3.5], "3.5"],
  ["%.3g", [3.14159], "3.14"],
  // %c
  ["%c", [65], "A"],
  ["%c", ["xyz"], "x"],
  ["[%3c]", ["a"], "[  a]"],
  // campuran, argumen kurang/lebih
  ["%s-%d-%.1f", ["a", 2, 3.04], "a-2-3.0"],
  ["%s dan %s", ["satu"], "satu dan "],
  ["%s", ["a", "b"], "a"],
  // spesifikasi tak dikenal dibiarkan, tidak menggeser argumen
  ["%z %d", [5], "%z 5"],
  ["%*d", [5], "%*d"],
];

describe("formatPrintf: tabel kasus", () => {
  for (const [format, args, expected] of CASES) {
    it(`${JSON.stringify(format)} ${JSON.stringify(args)} → ${JSON.stringify(expected)}`, () => {
      expect(formatPrintf(format, args)).toBe(expected);
    });
  }

  it("format bukan string / kosong", () => {
    expect(formatPrintf(undefined, [])).toBe("");
    expect(formatPrintf(null)).toBe("");
    expect(formatPrintf(123, [])).toBe("123");
  });
});
