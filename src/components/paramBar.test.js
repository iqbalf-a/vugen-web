import { describe, expect, it } from "vitest";

import { OUT_OF_RANGE_OPTIONS, UPDATE_OPTIONS, buildChange, parametersForFile, sameLineCandidates } from "./paramBar.js";

const params = [
  { name: "user", file: "u.dat", rows: 25, selectNextRow: "Sequential" },
  { name: "pass", file: "u.dat", rows: 25, selectNextRow: "Sequential" },
  { name: "ip", file: "data/ip.dat", rows: 1, selectNextRow: "Sequential" },
];

describe("parametersForFile", () => {
  it("mengembalikan semua parameter yang memakai .dat aktif", () => {
    expect(parametersForFile(params, "u.dat").map(p => p.name)).toEqual(["user", "pass"]);
  });

  it("kosong untuk file non-.dat, tanpa file aktif, atau tanpa parameter", () => {
    expect(parametersForFile(params, "Action.c")).toEqual([]);
    expect(parametersForFile(params, null)).toEqual([]);
    expect(parametersForFile(undefined, "u.dat")).toEqual([]);
  });
});

describe("sameLineCandidates", () => {
  it("hanya parameter lain dengan jumlah baris sama", () => {
    expect(sameLineCandidates(params[0], params).map(p => p.name)).toEqual(["pass"]);
    expect(sameLineCandidates(params[2], params)).toEqual([]);
  });

  it("pengikut tidak boleh jadi induk, dan induk tidak boleh jadi pengikut", () => {
    const linked = [
      params[0],
      { ...params[1], selectNextRow: "SameLine", sameLineAs: "user" },
      { name: "x", file: "x.dat", rows: 25, selectNextRow: "Sequential" },
    ];
    expect(sameLineCandidates(linked[2], linked).map(p => p.name)).toEqual(["user"]);
    expect(sameLineCandidates(linked[0], linked)).toEqual([]);
  });
});

describe("buildChange", () => {
  it("Same line as menjadi SameLine + induk; pilihan lain apa adanya", () => {
    expect(buildChange("selectNextRow", "same:userMaker")).toEqual({ selectNextRow: "SameLine", sameLineAs: "userMaker" });
    expect(buildChange("selectNextRow", "Unique")).toEqual({ selectNextRow: "Unique" });
    expect(buildChange("updateValueOn", "Once")).toEqual({ updateValueOn: "Once" });
    expect(buildChange("outOfRangePolicy", "Abort")).toEqual({ outOfRangePolicy: "Abort" });
  });
});

describe("opsi", () => {
  it("nilainya sama dengan yang diterima server", () => {
    expect(UPDATE_OPTIONS.map(o => o.value)).toEqual(["EachIteration", "EachOccurrence", "Once"]);
    expect(OUT_OF_RANGE_OPTIONS.map(o => o.value)).toEqual(["Continue", "Abort", "Cycle"]);
  });
});
