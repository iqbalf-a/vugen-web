import { describe, expect, it } from "vitest";

import { paramsAtEnd, paramsAtStep, sortByName } from "./params.js";

const change = (name, value, source = "lr_save_string") => ({ name, value, source, file: "Action.c", line: 3 });

const STEPS = [
  { seq: 1, params: [change("ip", "10.0.0.1", ".dat: ip.dat"), change("transName", "T1")] },
  { seq: 2, params: [change("transName", "T2"), change("token", "abc", "web_reg_save_param_json (JSONPath)")] },
  { seq: 3, params: [] },
  { seq: 4, params: [change("transName", "T3"), { name: "token", removed: true, source: "dihapus" }] },
  { seq: 5 }, // tanpa field params (data lama)
];

describe("paramsAtStep", () => {
  const valueOf = (rows, name) => rows.find((row) => row.name === name)?.value;

  it("nilai pada step N = perubahan 1..N diterapkan berurutan (transName berubah terus)", () => {
    expect(valueOf(paramsAtStep(STEPS, 1), "transName")).toBe("T1");
    expect(valueOf(paramsAtStep(STEPS, 2), "transName")).toBe("T2");
    expect(valueOf(paramsAtStep(STEPS, 3), "transName")).toBe("T2");
    expect(valueOf(paramsAtStep(STEPS, 4), "transName")).toBe("T3");
  });

  it("parameter baru muncul di step tempat ia diisi; yang dihapus hilang", () => {
    expect(paramsAtStep(STEPS, 1).map((row) => row.name).sort()).toEqual(["ip", "transName"]);
    expect(paramsAtStep(STEPS, 2).map((row) => row.name).sort()).toEqual(["ip", "token", "transName"]);
    expect(paramsAtStep(STEPS, 4).map((row) => row.name).sort()).toEqual(["ip", "transName"]);
  });

  it("menyimpan sumber dan posisi script dari perubahan terakhir", () => {
    expect(paramsAtStep(STEPS, 1).find((row) => row.name === "ip")).toMatchObject({ source: ".dat: ip.dat" });
    expect(paramsAtStep(STEPS, 2).find((row) => row.name === "token")).toMatchObject({ source: "web_reg_save_param_json (JSONPath)", file: "Action.c", line: 3 });
  });

  it("tanpa batas = semua step; step tanpa params diabaikan", () => {
    expect(valueOf(paramsAtStep(STEPS), "transName")).toBe("T3");
    expect(paramsAtStep([])).toEqual([]);
  });
});

describe("paramsAtEnd", () => {
  it("memakai run.params (nilai akhir, termasuk perubahan sesudah step terakhir) dengan asal dari step", () => {
    const rows = paramsAtEnd({ steps: STEPS, params: { ip: "10.0.0.1", transName: "T9", sisa: "x" } });
    expect(rows.find((row) => row.name === "transName")).toMatchObject({ value: "T9", source: "lr_save_string" });
    expect(rows.find((row) => row.name === "sisa")).toEqual({ name: "sisa", value: "x" });
  });

  it("tanpa run.params (run masih berjalan): dari perubahan step", () => {
    expect(paramsAtEnd({ steps: STEPS }).map((row) => row.name).sort()).toEqual(["ip", "transName"]);
  });
});

describe("sortByName", () => {
  const rows = [{ name: "id_10" }, { name: "Zeta" }, { name: "alpha" }, { name: "id_2" }];

  it("naik: tidak peka huruf, angka numerik", () => {
    expect(sortByName(rows).map((row) => row.name)).toEqual(["alpha", "id_2", "id_10", "Zeta"]);
  });

  it("turun", () => {
    expect(sortByName(rows, "desc").map((row) => row.name)).toEqual(["Zeta", "id_10", "id_2", "alpha"]);
  });

  it("tidak mengubah array asal", () => {
    const copy = rows.map((row) => row.name);
    sortByName(rows);
    expect(rows.map((row) => row.name)).toEqual(copy);
  });
});
