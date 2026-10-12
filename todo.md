# TODO — VuGen Web

Checklist kerja bertahap. Satu tahap = satu commit + berhenti untuk review.
Referensi kebenaran: `plan.md` (repo) dan `vugen-web-eksekusi.md` (rencana).

**Legenda status:** `[ ]` belum · `[~]` sedang dikerjakan · `[x]` selesai · `[!]` terblokir/butuh keputusan

**Default yang dipakai:**
`[x]` git init di awal F0 · `[!]` parser `.usr` best-effort + fallback (belum terverifikasi, perlu sampel VuGen asli) · `[!]` tambah `samples/core` khusus fungsi F3 · `[!]` ritme: berhenti di akhir setiap tahap

> Catatan identitas git: repo ini memakai config lokal `adidata.ardiansyah <adidata.ardiansyah@users.noreply.github.com>`.
> Ubah dengan `git config user.name/user.email` bila perlu.

---

## Progres keseluruhan

| Tahap | Status | Commit | Catatan |
|---|---|---|---|
| F0 Scaffold | `[x]` | `F0: scaffold vite + tailwind + plugin middleware + vitest` | AC lulus (health ok, 4/4 test, lint bersih) |
| F1 Loader + Editor | `[x]` | `F1: loader folder script + endpoint file + editor CodeMirror` | AC lulus (20/20 test, lint bersih, CRLF & isolation terverifikasi) |
| F2 Tokenizer + Parser | `[ ]` | — | — |
| F3 Transpile + Runtime inti | `[ ]` | — | — |
| F4 UI Run + Snapshot | `[ ]` | — | — |
| F5 Fungsi lanjut | `[ ]` | — | — |
| F6 Parameter + control flow (opsional) | `[ ]` | — | — |

---

## F0 — Scaffold ✅

- `[x]` `git init` + `.gitignore` (`.cache/`, `node_modules/`, `dist/`)
- `[x]` `package.json` (`type: module`; scripts `dev`, `test`, `lint`)
- `[x]` Pasang dependency: `undici`, `tough-cookie`, `@codemirror/{state,view,commands,language,search,lang-cpp}`; dev: `vite`, `@tailwindcss/vite`, `tailwindcss`, `vitest`, `eslint`, `@eslint/js`, `globals`
- `[x]` `vite.config.js` — `plugins: [tailwindcss(), vugenPlugin()]`, `server.host=127.0.0.1`, `server.watch.ignored` (`**/.cache/**`, `**/samples/**`), blok `test` Vitest
- `[x]` `eslint.config.js` (flat config, globals node + browser)
- `[x]` `index.html` — shell minimal (toolbar + 3 area)
- `[x]` `src/style.css` (`@import "tailwindcss";`), `src/main.js`, `src/store.js`, `src/api.js`
- `[x]` `server/http-utils.js` — `requestUrl`, `sendJson`, `sendError`, `readJsonBody`, `startSse()` (header SSE + heartbeat 15s + cleanup on close)
- `[x]` `server/vite-plugin.js` — `configureServer`, daftar middleware `/api`, registri child, cleanup saat `httpServer` close + process exit
- `[x]` `server/routes/index.js` — dispatch + `GET /api/health` → `{ ok: true }` (+ normalisasi prefix `/api`, 404/405 JSON)
- `[x]` `server/test/health.test.js` — 4 test
- `[x]` **AC:** `npm run dev` tampil; `GET /api/health` = ok; `npm test` hijau; `npm run lint` bersih
- `[x]` Commit `F0: scaffold vite + tailwind + plugin middleware + vitest`

## F1 — Loader + Editor ✅

- `[x]` `server/project/paths.js` — validasi path (tolak `..`, absolut luar root, symlink keluar) + hash path → folder cache
- `[x]` `server/project/loader.js` — scan `.usr`/`default.cfg`/`default.usp`/`*.c`/`*.h`/`*.prm`/`data/`; actions + Run Logic dari `.usr`/`.usp` best-effort; **fallback** `vuser_init.c → Action.c → vuser_end.c`
- `[x]` `server/project/save.js` — baca/simpan satu file: atomic (temp → rename), pertahankan CRLF/LF + encoding (utf8/utf8-bom/utf16le), backup ke `.cache/<hash>/backups/`
- `[x]` `server/routes/project.js` (`GET /api/project?path=`)
- `[x]` `server/routes/file.js` (`GET /api/file`, `PUT /api/file`)
- `[x]` `server/routes/index.js` — dispatcher diperbaiki: path yang sama boleh punya banyak method (GET+PUT `/file`)
- `[x]` `src/components/fileTree.js`
- `[x]` `src/components/editor.js` — CodeMirror 6 + `@codemirror/lang-cpp` + one-dark, `getValue`/`setDoc`/`focusLine`
- `[x]` `src/components/runToolbar.js` — input path + riwayat localStorage (datalist)
- `[x]` `samples/basic/` → `Action.c` (§9, CRLF), `vuser_init.c`, `vuser_end.c`, `globals.h`, `data/users.dat`
- `[x]` Test: `server/test/project.test.js` (path escape, fallback Run Logic, round-trip byte-identik, CRLF, backup, ekstensi, file lain tak tersentuh) + dispatch multi-method
- `[x]` **AC:** buka `samples/basic`, edit `Action.c`, Save → hanya `Action.c` yang berubah; CRLF tetap; Save tidak memicu reload (watcher mengabaikan `samples/`); escape → 400
- `[x]` Commit `F1: loader folder script + endpoint file + editor CodeMirror`

## F2 — Tokenizer + Parser

- `[ ]` `server/compiler/tokenizer.js` — string literal + escape (`\"`, `\\`, `\n`, `\x..`), concat literal bersebelahan, komentar `/* */` & `//`, makro `LAST`/`ITEMDATA`/`ENDITEM`/`EXTRARES`, angka, identifier, punctuation; token menyimpan `line`
- `[ ]` `server/compiler/parser.js` — ekstrak statement call: argumen string/angka/makro/nested call, multi-baris; AST + `file`/`line`; toleran (gagal → tandai, lanjut)
- `[ ]` `server/compiler/__fixtures__/` + golden test ≥10 kasus (escape, concat, komentar, ITEMDATA/ENDITEM, multi-baris)
- `[ ]` **AC:** parse seluruh `samples/basic/Action.c` tanpa error; setiap call punya `file` + `line` benar
- `[ ]` Commit `F2: tokenizer + parser call C + golden test`

## F3 — Transpile + Runtime inti

- `[ ]` `server/compiler/transpile.js` — AST → JS internal, penanda `__at("file", line)`, `await` untuk `web_*`/`lr_*`, `__unsupported("asli")`; output ke `.cache/<hash>/build/`
- `[ ]` `server/runtime/http-client.js` — undici + tough-cookie + redirect manual (catat hop) + timeout + `insecureTLS`
- `[ ]` `server/runtime/vuser-api.js` — 7.1 inti; substitusi `{param}` runtime (tak ketemu → biarkan + warning)
- `[ ]` `server/runtime/runner.js` — entry `fork`; init 1× → Action ×N → end 1×; `continueOnError`/`iterationDelayMs`/`newUserEachIteration`/`thinkTime`; kirim event ke parent
- `[ ]` `server/runs/store.js` — `@typedef RunResult` (§7.3) + tulis `run.json` + `steps/<seq>.body` (batas 5 MB, flag `truncated`) + decode charset
- `[ ]` `server/test/mock.js` — mock `node:http` melayani `/` dan `/login`
- `[ ]` `samples/core/` — sampel fungsi F3 saja (`web_url`, `lr_*`, `web_add_header`)
- `[ ]` Test: run CLI langsung tanpa UI
- `[ ]` **AC:** `run.json` step/status/header/body/transaksi/line benar; unsupported → warning; `iterations=3` → init & end 1×, Action 3×, `iteration` 1..3
- `[ ]` Commit `F3: transpiler + runner fork + penyimpanan hasil run`

## F4 — UI Run + Snapshot

- `[ ]` `server/routes/run.js` — `POST /api/run`, `GET /api/run/:id/events` (SSE), `POST /api/run/:id/stop`, `GET /api/run/:id`, `GET /api/run/:id/step/:seq/body`
- `[ ]` `src/components/stepList.js` + selector iterasi (1..N)
- `[ ]` `src/components/snapshotPanel.js` — iframe `sandbox=""` srcdoc, CSP `default-src 'none'`, toggle "Load resources"
- `[ ]` Panel Request / Response / Parameter / Log
- `[ ]` Sinkron klik step ↔ baris editor (dua arah)
- `[ ]` Kontrol jumlah iterasi + opsi run di toolbar; indikator status
- `[ ]` **AC:** Run → step live → snapshot tampil; Stop <2s tanpa proses yatim; error menunjuk baris C benar; restart Vite bersih
- `[ ]` Commit `F4: UI run live + snapshot + panel`

## F5 — Fungsi lanjutan

- `[ ]` `web_submit_data` (ITEMDATA/ENDITEM), `web_submit_form` (sederhana)
- `[ ]` `web_reg_save_param`, `web_reg_save_param_ex`, `web_reg_save_param_regexp`
- `[ ]` `web_reg_find`
- `[ ]` `web_add_cookie`, `web_cleanup_cookies`, `web_set_user`
- `[ ]` **AC:** login 3 langkah dengan correlation (token step 1 dipakai step 2); tab Parameter menampilkan nilai correlation
- `[ ]` Commit `F5: web_submit_data + correlation + cookie`

## F6 — Parameter file + control flow (opsional)

- `[ ]` Parameter `.prm`/`data/*.dat` (sequential, ganti per iterasi)
- `[ ]` Subset C: `if/else/for/while`, `int`, `char*`, `strcmp`, `sprintf`, `atoi`, `strcpy`
- `[ ]` **AC:** script sampel dengan loop + if berjalan sesuai ekspektasi
- `[ ]` Commit `F6: parameter file + subset control flow C`

---

## Jangan dikerjakan sekarang
- Recording / baca `data/tN.inf`
- Multi-VU / k6
- Step Toolbox (plan §10)
- Mengubah struktur folder script VuGen

## Aturan keras pengingat (plan §4)
1. Folder script read-only, kecuali Save pada `.c`/`.h`.
2. Semua artefak ke `.cache/<hash-path-script>/`.
3. Save atomic + pertahankan EOL/encoding + backup.
4. Jangan menebak format VuGen — verifikasi dengan sampel nyata.
5. Fungsi unsupported → warning, lanjut, jangan crash.
6. Commit kecil per tahap.
7. Watcher ignore `.cache/` + folder script.
8. Kill child run saat server close / Vite restart / proses keluar.
