import { describe, expect, it } from "vitest";

import { fileTitle, groupFiles } from "./fileGroups.js";

const f = (name, category, extra = {}) => ({ path: name, name, ext: name.slice(name.lastIndexOf(".")), category, ...extra });

describe("groupFiles", () => {
  const files = [
    f("z.dat", "data"), f("a.dat", "data"), f("x.prm", "data"),
    f("Logout.c", "actions", { order: 3 }),
    f("vuser_init.c", "actions", { order: 0 }),
    f("BP000.c", "actions", { order: 1 }),
    f("login.js", "extra"), f("globals.h", "extra"),
    f("s.usr", "settings"),
  ];
  const groups = groupFiles(files);

  it("urutan grup tetap dan grup kosong dibuang", () => {
    expect(groups.map(group => group.id)).toEqual(["actions", "extra", "data", "settings"]);
    expect(groupFiles([f("g.h", "extra")]).map(group => group.id)).toEqual(["extra"]);
  });

  it("Actions mengikuti urutan script, bukan abjad", () => {
    expect(groups[0].files.map(file => file.name)).toEqual(["vuser_init.c", "BP000.c", "Logout.c"]);
  });

  it("Extra Files urut abjad", () => {
    expect(groups[1].files.map(file => file.name)).toEqual(["globals.h", "login.js"]);
  });

  it(".prm di atas .dat pada grup Data", () => {
    expect(groups[2].files.map(file => file.name)).toEqual(["x.prm", "a.dat", "z.dat"]);
  });

  it("kategori tak dikenal masuk Settings", () => {
    expect(groupFiles([f("q.xyz", "action-utama")])[0].id).toBe("settings");
  });
});

describe("fileTitle", () => {
  it("action pasif menyebut semua pemanggil", () => {
    const title = fileTitle(f("Prelogin.c", "actions", { state: "passive", calledBy: ["Maker.c", "Approver.c"] }));
    expect(title).toContain("passive");
    expect(title).toContain("Maker, Approver");
  });

  it("action aktif, unlinked, dan file biasa", () => {
    expect(fileTitle(f("Maker.c", "actions", { state: "active" }))).toContain("active");
    expect(fileTitle(f("Old.c", "actions", { state: "unlinked" }))).toContain("not listed");
    expect(fileTitle(f("a.dat", "data"))).toBe("a.dat");
  });
});
