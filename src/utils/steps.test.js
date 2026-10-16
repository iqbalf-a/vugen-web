import { describe, expect, it } from "vitest";

import { availableGroups, groupLabel, stepGroupOf } from "./steps.js";

const RUN_LOGIC = { init: "vuser_init.c", end: "vuser_end.c" };

describe("stepGroupOf", () => {
  it("step dari vuser_init.c / vuser_end.c tidak bercampur dengan Action iterasi 1", () => {
    expect(stepGroupOf({ file: "vuser_init.c", iteration: 1 }, RUN_LOGIC)).toBe("init");
    expect(stepGroupOf({ file: "vuser_end.c", iteration: 1 }, RUN_LOGIC)).toBe("end");
    expect(stepGroupOf({ file: "Action.c", iteration: 1 }, RUN_LOGIC)).toBe(1);
    expect(stepGroupOf({ file: "Loadpage.c", iteration: 3 }, RUN_LOGIC)).toBe(3);
  });

  it("huruf besar/kecil dan direktori diabaikan; fallback ke nama bawaan bila runLogic kosong", () => {
    expect(stepGroupOf({ file: "Vuser_Init.C", iteration: 1 }, RUN_LOGIC)).toBe("init");
    expect(stepGroupOf({ file: "sub\\vuser_end.c", iteration: 1 }, null)).toBe("end");
  });

  it("init/end bernama lain mengikuti Run Logic", () => {
    const logic = { init: "Init_Custom.c", end: "End_Custom.c" };
    expect(stepGroupOf({ file: "init_custom.c", iteration: 1 }, logic)).toBe("init");
    expect(stepGroupOf({ file: "vuser_init.c", iteration: 1 }, logic)).toBe(1);
  });

  it("step tanpa file/iterasi jatuh ke iterasi 1", () => {
    expect(stepGroupOf({}, RUN_LOGIC)).toBe(1);
  });
});

describe("availableGroups", () => {
  it("init dan end hanya muncul bila ada step-nya; iterasi 1..N selalu ada", () => {
    const steps = [
      { file: "vuser_init.c", iteration: 1 },
      { file: "Action.c", iteration: 1 },
      { file: "Action.c", iteration: 2 },
      { file: "vuser_end.c", iteration: 1 },
    ];
    expect(availableGroups(steps, 3, RUN_LOGIC)).toEqual(["init", 1, 2, 3, "end"]);
    expect(availableGroups([{ file: "Action.c", iteration: 1 }], 2, RUN_LOGIC)).toEqual([1, 2]);
    expect(availableGroups([], 1, RUN_LOGIC)).toEqual([1]);
  });

  it("memakai iterasi tertinggi yang ada walau total lebih kecil (run live)", () => {
    expect(availableGroups([{ file: "Action.c", iteration: 4 }], 1, RUN_LOGIC)).toEqual([1, 2, 3, 4]);
  });
});

describe("groupLabel", () => {
  it("label yang mudah dibaca", () => {
    expect(groupLabel("init")).toBe("vuser_init");
    expect(groupLabel("end")).toBe("vuser_end");
    expect(groupLabel(2)).toBe("Iterasi 2");
  });
});
