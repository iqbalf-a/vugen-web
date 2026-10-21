import { describe, expect, it } from "vitest";

import { collectFunctions, filterFunctions, groupByCategory, markMatch } from "./toolbox.js";

const MODULES = {
  "a.json": { default: [{ name: "web_url", category: "Web", description: "Buka URL" }, { name: "" }, null] },
  "b.json": [{ name: "lr_think_time", category: "Utility", description: "Jeda" }, { name: "web_url", category: "X" }],
};

describe("toolbox", () => {
  it("collectFunctions: gabung, buang entri rusak & duplikat, urut nama", () => {
    const list = collectFunctions(MODULES);
    expect(list.map(f => f.name)).toEqual(["lr_think_time", "web_url"]);
    expect(list.find(f => f.name === "web_url").category).toBe("Web");
  });

  it("filterFunctions: cocok nama/kategori/deskripsi, kosong = semua", () => {
    const list = collectFunctions(MODULES);
    expect(filterFunctions(list, "")).toHaveLength(2);
    expect(filterFunctions(list, "THINK").map(f => f.name)).toEqual(["lr_think_time"]);
    expect(filterFunctions(list, "buka").map(f => f.name)).toEqual(["web_url"]);
    expect(filterFunctions(list, "utility")).toHaveLength(1);
  });

  it("groupByCategory: kelompok terurut", () => {
    const groups = groupByCategory(collectFunctions(MODULES));
    expect(groups.map(g => g.category)).toEqual(["Utility", "Web"]);
    const ordered = groupByCategory([{ name: "a", category: "C: Math" }, { name: "b", category: "LoadRunner (lr_)" }, { name: "c", category: "Web: Requests & Navigation" }]);
    expect(ordered.map(g => g.category)).toEqual(["Web: Requests & Navigation", "LoadRunner (lr_)", "C: Math"]);
  });
});

describe("markMatch", () => {
  it("membungkus bagian yang cocok dan meng-escape sisanya", () => {
    expect(markMatch("web_url", "URL")).toBe("web_<mark>url</mark>");
    expect(markMatch("a<b", "<")).toBe("a<mark>&lt;</mark>b");
    expect(markMatch("web_url", "")).toBe("web_url");
    expect(markMatch("web_url", "zzz")).toBe("web_url");
  });
});
