import { describe, expect, it } from "vitest";

import { availableGroups, endpointLabel, endpointParts, formatMs, groupLabel, shortPath, snapshotInfo, statusLabel, stepGroupOf } from "./steps.js";

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

describe("endpointLabel", () => {
  it("METHOD + path dari URL request; host dan query dibuang", () => {
    const step = { name: "RPS_25_inquirylogin", request: { method: "post", url: "https://10.0.0.1:8443/new/kopra/api/secured/inquiry/login?x=1&y=2" } };
    expect(endpointLabel(step)).toBe("POST /new/kopra/api/secured/inquiry/login");
  });

  it("URL akar -> '/'", () => {
    expect(endpointLabel({ name: "home", request: { method: "GET", url: "http://127.0.0.1:18081/" } })).toBe("GET /");
  });

  it("tanpa URL / URL tidak valid -> nama step; tanpa keduanya -> placeholder", () => {
    expect(endpointLabel({ name: "RPS_26_inquiry", request: { method: "GET", url: "" } })).toBe("RPS_26_inquiry");
    expect(endpointLabel({ name: "x", request: { method: "GET", url: "bukan url" } })).toBe("x");
    expect(endpointLabel({})).toBe("(tanpa nama)");
  });

  it("tanpa method: hanya path", () => {
    expect(endpointLabel({ request: { url: "http://h/a/b" } })).toBe("/a/b");
  });
});

describe("formatMs", () => {
  it("< 10 ms satu desimal, selebihnya bulat", () => {
    expect(formatMs(5.24)).toBe("5.2ms");
    expect(formatMs(0)).toBe("0ms");
    expect(formatMs(24.4)).toBe("24ms");
    expect(formatMs(1234.6)).toBe("1235ms");
    expect(formatMs(undefined)).toBe("0ms");
  });
});

describe("snapshotInfo", () => {
  const mk = (seq, url, iteration = 1, file = "Action.c") => ({ seq, file, iteration, name: `RPS_${seq}`, request: { method: "GET", url } });
  const steps = [
    mk(1, "http://h/a/x"),
    mk(2, "http://h/api/q?x=1"),
    mk(3, "http://h/api/q?x=2"), // endpoint sama (query dibuang)
    mk(4, "http://h/api/q", 2), // iterasi lain: bukan duplikat dari iterasi 1
    mk(5, "http://h/api/q", 1, "vuser_end.c"),
  ];

  it("nomor snapshot = seq; endpoint dari URL", () => {
    expect(snapshotInfo(steps[0], steps, RUN_LOGIC)).toMatchObject({ number: 1, endpoint: "GET /a/x", group: 1, duplicate: null });
  });

  it("duplikat dihitung per grup: urutan dan total pemanggilan endpoint yang sama", () => {
    expect(snapshotInfo(steps[1], steps, RUN_LOGIC).duplicate).toEqual({ index: 1, total: 2 });
    expect(snapshotInfo(steps[2], steps, RUN_LOGIC).duplicate).toEqual({ index: 2, total: 2 });
  });

  it("iterasi lain dan vuser_end tidak dihitung sebagai duplikat", () => {
    expect(snapshotInfo(steps[3], steps, RUN_LOGIC)).toMatchObject({ group: 2, duplicate: null });
    expect(snapshotInfo(steps[4], steps, RUN_LOGIC)).toMatchObject({ group: "end", duplicate: null });
  });
});

describe("endpointParts", () => {
  it("method (huruf besar) dan path terpisah", () => {
    expect(endpointParts({ request: { method: "post", url: "https://h:8443/a/b?x=1" } })).toEqual({ method: "POST", path: "/a/b" });
  });

  it("tanpa URL valid: method kosong, path = nama step", () => {
    expect(endpointParts({ name: "RPS_1", request: { method: "GET", url: "bukan url" } })).toEqual({ method: "", path: "RPS_1" });
  });
});

describe("shortPath", () => {
  it("path pendek tidak diubah", () => {
    expect(shortPath("/home")).toBe("/home");
    expect(shortPath("/api/public/content")).toBe("/api/public/content");
  });

  it("path panjang: dua segmen terakhir dengan awalan …/", () => {
    expect(shortPath("/new/kopra/api/public/content/inquiry")).toBe("…/content/inquiry");
  });

  it("batas dapat diatur; path dengan <= 2 segmen tidak dipotong", () => {
    expect(shortPath("/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbb")).toBe("/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbb");
    expect(shortPath("/a/b/c/d", 4)).toBe("…/c/d");
  });
});

describe("statusLabel", () => {
  it("hanya kode bila statusText kosong (tanpa tanda '-')", () => {
    expect(statusLabel(200, "")).toBe("200");
    expect(statusLabel(500, undefined)).toBe("500");
  });

  it("kode + teks bila ada; tanpa kode -> '-'", () => {
    expect(statusLabel(404, "Not Found")).toBe("404 Not Found");
    expect(statusLabel(0, "")).toBe("-");
    expect(statusLabel(undefined)).toBe("-");
  });
});
