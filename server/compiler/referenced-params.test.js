import { describe, expect, it } from "vitest";

import { findReferencedParams } from "./referenced-params.js";

const names = (source) => [...findReferencedParams(source)].sort();

describe("findReferencedParams", () => {
  it("placeholder {nama} di string URL, header, dan lr_eval_string", () => {
    const source = 'web_url(lr_eval_string("RPS_{subTrans}_01"), "URL=https://{ip}/a", "Referer=https://{ip}/", LAST);';
    expect(names(source)).toEqual(["ip", "subTrans"]);
  });

  it("LR.getParam('nama') di web_js_run", () => {
    expect(names("web_js_run(\"Code= myFunc(LR.getParam('parentTrans'));\", LAST);")).toEqual(["parentTrans"]);
  });

  it("kurung kurawal C dan JSON bukan parameter", () => {
    const source = 'if (a) { b(); } web_custom_request("x", "Body={\\"contentId\\":[\\"A\\"]}", LAST);';
    expect(names(source)).toEqual([]);
  });

  it("nama dengan titik/strip/angka; {} kosong tidak dihitung", () => {
    expect(names("{user.name} {a-b} {x_1} {} { }")).toEqual(["a-b", "user.name", "x_1"]);
  });

  it("mengisi himpunan yang diberikan (akumulasi antar file)", () => {
    const into = new Set(["lama"]);
    findReferencedParams("{baru}", into);
    expect([...into].sort()).toEqual(["baru", "lama"]);
  });
});
