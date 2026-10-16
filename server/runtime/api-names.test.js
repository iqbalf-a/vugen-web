import { describe, expect, it } from "vitest";

import { SUPPORTED_FUNCTIONS } from "./api-names.js";
import * as vuserApi from "./vuser-api.js";

describe("api-names: sinkron dengan vuser-api.js", () => {
  const exported = Object.keys(vuserApi)
    .filter((name) => !name.startsWith("__") && name !== "default")
    .sort();

  it("setiap nama di daftar benar-benar diekspor sebagai fungsi", () => {
    for (const name of SUPPORTED_FUNCTIONS) {
      expect(typeof vuserApi[name], name).toBe("function");
    }
  });

  it("setiap fungsi yang diekspor (tanpa awalan __) terdaftar", () => {
    expect([...SUPPORTED_FUNCTIONS].sort()).toEqual(exported);
  });

  it("tanpa duplikat", () => {
    expect(new Set(SUPPORTED_FUNCTIONS).size).toBe(SUPPORTED_FUNCTIONS.length);
  });
});
