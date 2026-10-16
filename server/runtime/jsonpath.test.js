import { describe, expect, it } from "vitest";

import { compileJsonPath, queryJsonPath } from "./jsonpath.js";

const DOC = {
  data: {
    token: "T-1",
    profile: { kopraId: "K-9", companyId: "C-1", tags: ["a", "b"] },
    items: [
      { id: 10, name: "satu", companyId: "C-2" },
      { id: 20, name: "dua", extra: { companyId: "C-3" } },
      { id: 30, name: "tiga" },
    ],
    flag: true,
    nothing: null,
    "dengan-strip": "ok",
    "dengan spasi": "sp",
  },
  token: "T-ROOT",
};

const run = (path, doc = DOC) => queryJsonPath(doc, compileJsonPath(path));

/** [path, hasil yang diharapkan (semua match, urutan dokumen)] */
const CASES = [
  ["$", [DOC]],
  ["$.token", ["T-ROOT"]],
  ["$.data.token", ["T-1"]],
  ["$.data.profile.kopraId", ["K-9"]],
  ["$.data.profile.tags[1]", ["b"]],
  ["$.data.items[0].id", [10]],
  ["$.data.items[2].name", ["tiga"]],
  ["$.data.items[1].extra.companyId", ["C-3"]],
  ["$.data.items[5].id", []],
  ["$.data.items[*].id", [10, 20, 30]],
  ["$.data.items[*].name", ["satu", "dua", "tiga"]],
  ["$.data.profile.tags[*]", ["a", "b"]],
  ["$.data['token']", ["T-1"]],
  ['$.data["token"]', ["T-1"]],
  ["$.data['dengan-strip']", ["ok"]],
  ["$.data['dengan spasi']", ["sp"]],
  ["$['data']['profile']['kopraId']", ["K-9"]],
  // recursive descent: semua kemunculan, pre-order (node ini dulu, baru turunannya)
  ["$..token", ["T-ROOT", "T-1"]],
  ["$..companyId", ["C-1", "C-2", "C-3"]],
  ["$..id", [10, 20, 30]],
  ["$..kopraId", ["K-9"]],
  ["$.data..companyId", ["C-1", "C-2", "C-3"]],
  ["$..items[0]", [{ id: 10, name: "satu", companyId: "C-2" }]],
  ["$..tags[0]", ["a"]],
  // tipe nilai
  ["$.data.flag", [true]],
  ["$.data.nothing", [null]],
  // tidak ada
  ["$.tidakAda", []],
  ["$.data.token.dalam", []],
  ["$..tidakAda", []],
  ["$.data.profile[0]", []],
];

describe("jsonpath: tabel kasus", () => {
  for (const [path, expected] of CASES) {
    it(`${path}`, () => {
      expect(run(path)).toEqual(expected);
    });
  }

  it("dokumen akar array: $[0], $[*], $..a", () => {
    const doc = [{ a: 1 }, { a: 2 }];
    expect(run("$[0].a", doc)).toEqual([1]);
    expect(run("$[*].a", doc)).toEqual([1, 2]);
    expect(run("$..a", doc)).toEqual([1, 2]);
  });

  it("[*] pada objek mengembalikan semua nilainya", () => {
    expect(run("$.data.profile[*]", DOC).slice(0, 2)).toEqual(["K-9", "C-1"]);
  });
});

describe("jsonpath: sintaks tidak didukung -> error yang jelas", () => {
  const BAD = [
    ["", /\$/],
    ["data.token", /\$/],
    ["$.", /nama/],
    ["$..", /nama/],
    ["$.data[", /\]/],
    ["$.data[abc]", /tidak didukung/],
    ["$.data[-1]", /tidak didukung/],
    ["$.data[1:2]", /tidak didukung/],
    ["$.data[?(@.a==1)]", /tidak didukung/],
    ["$.*", /\[\*\]/],
    ["$..*", /\[\*\]/],
    ["$.data['x]", /kutip/],
    ["$.data[0", /\]/],
  ];
  for (const [path, message] of BAD) {
    it(`${JSON.stringify(path)}`, () => {
      expect(() => compileJsonPath(path)).toThrow(message);
    });
  }
});
