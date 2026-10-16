import { describe, expect, it } from "vitest";

import { TrackedParams } from "./tracked-params.js";

describe("TrackedParams", () => {
  const make = () => {
    const position = { file: "Action.c", line: 10 };
    return { params: new TrackedParams(() => ({ ...position })), position };
  };

  it("tetap berperilaku seperti Map", () => {
    const { params } = make();
    params.set("a", "1");
    expect(params.get("a")).toBe("1");
    expect(params.has("a")).toBe(true);
    expect(Object.fromEntries(params)).toEqual({ a: "1" });
    expect(params.delete("a")).toBe(true);
    expect(params.size).toBe(0);
  });

  it("drain mengembalikan perubahan dengan sumber dan posisi script, lalu mengosongkan", () => {
    const { params, position } = make();
    params.set("transName", "T1", "lr_save_string");
    position.line = 22;
    params.set("token", "abc", "web_reg_save_param_json (JSONPath)");

    expect(params.drain()).toEqual([
      { name: "transName", value: "T1", source: "lr_save_string", file: "Action.c", line: 10 },
      { name: "token", value: "abc", source: "web_reg_save_param_json (JSONPath)", file: "Action.c", line: 22 },
    ]);
    expect(params.drain()).toEqual([]);
  });

  it("nilai berubah berulang di antara dua step: hanya nilai terakhir yang tercatat", () => {
    const { params } = make();
    params.set("transName", "T1", "lr_save_string");
    params.set("transName", "T2", "lr_save_string");
    params.set("transName", "T3", "lr_save_string");
    expect(params.drain().map((change) => [change.name, change.value])).toEqual([["transName", "T3"]]);
    // sesudah drain, perubahan berikutnya tercatat lagi walau nilainya sama
    params.set("transName", "T3", "lr_save_string");
    expect(params.drain()).toHaveLength(1);
  });

  it("delete tercatat sebagai removed; delete nama yang tidak ada tidak mencatat apa pun", () => {
    const { params } = make();
    params.set("x", "1");
    params.drain();
    params.delete("x");
    params.delete("tidak-ada");
    expect(params.drain()).toEqual([expect.objectContaining({ name: "x", removed: true })]);
  });

  it("sumber default 'script'", () => {
    const { params } = make();
    params.set("x", "1");
    expect(params.drain()[0].source).toBe("script");
  });
});
