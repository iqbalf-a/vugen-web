import { describe, expect, it } from "vitest";

import { summarizeRunSettings } from "./runSettings.js";

const BASE = { iterations: 1, delayMs: 0, newUser: false, continueOnError: false, insecureTLS: false, thinkTime: "ignore" };

describe("summarizeRunSettings", () => {
  it("default minimal: hanya jumlah iterasi", () => {
    expect(summarizeRunSettings(BASE)).toEqual([{ text: "1 iteration" }]);
  });

  it("semua opsi aktif, TLS ditandai warn", () => {
    const parts = summarizeRunSettings({ iterations: 5, delayMs: 250, newUser: true, continueOnError: true, insecureTLS: true, thinkTime: "run" });
    expect(parts.map(part => part.text)).toEqual(["5 iterations", "250 ms delay", "new user", "continue on error", "think time", "insecure TLS"]);
    expect(parts.filter(part => part.warn).map(part => part.text)).toEqual(["insecure TLS"]);
  });

  it("delay tidak ditampilkan bila hanya satu iterasi", () => {
    expect(summarizeRunSettings({ ...BASE, delayMs: 500 }).map(part => part.text)).toEqual(["1 iteration"]);
  });

  it("nilai tidak valid dinormalisasi", () => {
    expect(summarizeRunSettings({ ...BASE, iterations: "abc" })[0].text).toBe("1 iteration");
    expect(summarizeRunSettings({ ...BASE, iterations: 0 })[0].text).toBe("1 iteration");
  });
});
