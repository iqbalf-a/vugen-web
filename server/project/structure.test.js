import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadProject } from "./loader.js";
import { findCalls, layoutFiles, parseUsr } from "./structure.js";

const file = (p) => ({ path: p, name: p.split("/").pop(), ext: p.slice(p.lastIndexOf(".")).toLowerCase() });

describe("findCalls", () => {
  it("mengurutkan berdasarkan kemunculan pertama dan mengabaikan komentar", () => {
    const text = `
      // Login(x);
      Prelogin(a);
      /* Dashboard(); */
      Login(a);
      logoutUser();`;
    expect(findCalls(text, ["Login", "Prelogin", "Dashboard"])).toEqual(["Prelogin", "Login"]);
  });

  it("tidak cocok dengan nama yang hanya berakhiran sama", () => {
    expect(findCalls("preLogin(1); obj.Login(2);", ["Login"])).toEqual([]);
  });
});

describe("parseUsr", () => {
  const text = [
    "[General]", "Type=Multi", "[Actions]", "vuser_init=vuser_init.c", "A=A.c", "[ExtraFiles]",
    "globals.h=", "login.js=", "img\\logo.png=", "[Modified Actions]", "A=1",
  ].join("\r\n");

  it("membaca urutan action dan Extra Files", () => {
    expect(parseUsr(text)).toEqual({ actions: ["vuser_init.c", "A.c"], extraFiles: ["globals.h", "login.js", "img/logo.png"] });
  });

  it("tanpa [Actions] mengembalikan null", () => {
    expect(parseUsr("[General]\nType=Multi").actions).toBeNull();
  });
});

describe("layoutFiles", () => {
  const files = [
    "BP001_Maker.c", "BP001_Approver.c", "Loadpage.c", "Prelogin.c", "Orphan.c", "globals.h", "login.js", "logo.png",
    "a.dat", "a.prm", "script.usr", "default.cfg", "vuser_end.c", "vuser_init.c",
  ].map(file);
  const texts = new Map([
    ["BP001_Maker.c", "BP001_Maker(){ Loadpage(); Prelogin(); }"],
    ["BP001_Approver.c", "BP001_Approver(){ Loadpage(); Prelogin(); }"],
  ]);
  const layout = layoutFiles(
    files,
    {
      init: "vuser_init.c",
      end: "vuser_end.c",
      runActions: ["BP001_Maker.c", "BP001_Approver.c"],
      listed: ["vuser_init.c", "BP001_Maker.c", "BP001_Approver.c", "Loadpage.c", "Prelogin.c", "vuser_end.c"],
      extraListed: new Set(["globals.h", "logo.png"]),
    },
    texts,
  );
  const actions = [...layout].filter(([, info]) => info.category === "actions").sort((a, b) => a[1].order - b[1].order);

  it("action rata dalam urutan script, tanpa nesting", () => {
    expect(actions.map(([p]) => p)).toEqual([
      "vuser_init.c", "BP001_Maker.c", "BP001_Approver.c", "Loadpage.c", "Prelogin.c", "vuser_end.c", "Orphan.c",
    ]);
  });

  it("status: aktif (Run Logic, init, end), pasif (hanya dipanggil), unlinked (tidak ada di script)", () => {
    expect(layout.get("BP001_Maker.c").state).toBe("active");
    expect(layout.get("vuser_init.c").state).toBe("active");
    expect(layout.get("Loadpage.c").state).toBe("passive");
    expect(layout.get("Orphan.c").state).toBe("unlinked");
  });

  it("action pasif menyimpan semua pemanggilnya", () => {
    expect(layout.get("Prelogin.c").calledBy).toEqual(["BP001_Maker.c", "BP001_Approver.c"]);
  });

  it("Extra Files: header, .js, dan file di [ExtraFiles]", () => {
    for (const name of ["globals.h", "login.js", "logo.png"]) expect(layout.get(name).category).toBe("extra");
  });

  it("data dan settings", () => {
    expect(layout.get("a.dat").category).toBe("data");
    expect(layout.get("a.prm").category).toBe("data");
    expect(layout.get("script.usr").category).toBe("settings");
    expect(layout.get("default.cfg").category).toBe("settings");
  });

  it("tanpa .usr [Actions]: semua .c di root dianggap action", () => {
    const flat = layoutFiles([file("Action.c"), file("Helper.c")], { init: null, end: null, runActions: ["Action.c"], listed: null, extraListed: new Set() }, new Map());
    expect(flat.get("Helper.c")).toMatchObject({ category: "actions", state: "passive" });
  });
});

describe("loadProject: Extra Files", () => {
  let dir;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "vugen-struct-"));
    await fs.mkdir(path.join(dir, "img"));
    await fs.mkdir(path.join(dir, "result1"));
    await fs.writeFile(path.join(dir, "Action.c"), "Action(){ return 0; }");
    await fs.writeFile(path.join(dir, "login.js"), "function login(){}");
    await fs.writeFile(path.join(dir, "result1", "noise.js"), "x");
    await fs.writeFile(path.join(dir, "img", "logo.png"), Buffer.from([0x89, 0x50, 0, 0]));
    await fs.writeFile(path.join(dir, "notes.json"), "{}");
    await fs.writeFile(path.join(dir, "s.usr"), "[Actions]\nAction=Action.c\n[ExtraFiles]\nimg\\logo.png=\n");
    dir = await fs.realpath(dir);
  });
  afterAll(() => fs.rm(dir, { recursive: true, force: true }));

  it("mendaftar .js di root dan file [ExtraFiles], tanpa .js/.json lain", async () => {
    const project = await loadProject(dir);
    const names = project.files.map((f) => f.path).sort();
    expect(names).toContain("login.js");
    expect(names).toContain("img/logo.png");
    expect(names).not.toContain("result1/noise.js");
    expect(names).not.toContain("notes.json");
    expect(project.files.find((f) => f.path === "img/logo.png").category).toBe("extra");
  });
});
