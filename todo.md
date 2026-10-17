# TODO — VuGen Web

Status proyek yang **jujur** per akhir stabilisasi (S0–S7, 2026-10-16). Rencana kerja: `plan-stabilisasi.md`; spesifikasi produk: `plan.md`.

**Legenda status:** `[ ]` belum · `[~]` sebagian · `[x]` selesai · `[!]` terblokir/butuh keputusan

> Catatan identitas git: repo ini memakai config lokal `adidata.ardiansyah <adidata.ardiansyah@users.noreply.github.com>`.
> Ubah dengan `git config user.name/user.email` bila perlu.

---

## Progres fitur (F0–F6)

| Tahap | Status | Commit | Catatan jujur |
|---|---|---|---|
| F0 Scaffold | `[x]` | `74b0dc3` | health, vitest, lint |
| F1 Loader + Editor | `[x]` | `21a3f2c` (+ `f0f711b` CRLF) | CRLF, save atomic, isolasi path terverifikasi |
| F2 Tokenizer + Parser | `[x]` | `6b90a91` | diperluas di S4 (deklarasi, header kontrol alur, switch, cast) |
| F3 Transpile + Runtime inti | `[x]` | kode: `f2dfb97` (S0) | Sebelumnya hanya "kode ada". Kini terverifikasi lewat test integrasi S2–S5 (`run.f5`, `run.kopra`, `run.lifecycle`, `runtime`). |
| F4 UI Run + Snapshot | `[x]` | kode: `f2dfb97` (S0) | Terverifikasi di Chrome headless (S6): step live, snapshot di iframe sandbox, ganti iterasi, Stop, editor ↔ step. Dua sinkronisasi editor ↔ step baru benar-benar bekerja di S6 (sebelumnya tidak terpasang). |
| F5 Fungsi lanjut | `[x]` | kode: `f2dfb97` (S0) | Login 3 langkah + correlation + `web_reg_find` jalan ke mock (`run.f5.test.js`). |
| F6 Parameter + control flow | `[x]` | kode: `f2dfb97` (S0) | Control flow & deklarasi C: selesai (S4). Parameter `.dat`: selesai (S6). Mesin parameter `.prm`: selesai — `parsePrm`, `SelectNextRow` (Sequential/Random/Unique), `UpdateValueOn` (Once), `OutOfRangePolicy` (Cycle/Continue/Abort). Time/Userid: backlog. |

## Progres stabilisasi (S0–S7)

| Tahap | Status | Commit | Isi |
|---|---|---|---|
| S0 | `[x]` | `f2dfb97` | Bersihkan working tree, lint 0, checkpoint kode F3–F6 |
| S1 | `[x]` | `a6185cc` | Keamanan UI: `escapeHtml` benar (sebelumnya no-op di 6 tempat), snapshot HTML di `<iframe sandbox="">` |
| S2 | `[x]` | `6127502` | Jalur step end-to-end: `execute.js`, event objek, body per step, `run.json` benar-benar tertulis, hapus mekanisme `snapshots/` |
| S3 | `[x]` | `869d327` | Satu registri run, Stop < 2 s, SSE push + replay, routing satu lapis |
| S4 | `[x]` | `a1ee85f` | Transpiler: header kontrol alur jadi ekspresi, deklarasi multi, global modul, `api-names.js`, makro status angka |
| S5 | `[x]` | `f6197c9`, `21e314c` | Runtime: `web_js_run` (vm), header auto/sekali pakai, cookie, printf, transaksi bersarang Pass/Fail, step gagal; iterasi gagal tidak menghentikan run |
| S6 | `[x]` | `e7c2565` | Loader parameter `.dat`, frontend: `selectedIteration` di store, grup `vuser_init`/`vuser_end`, transaksi Fail terlihat |
| S7 | `[x]` | commit `S7: …` (`git log --grep "^S7"`) | Rapikan akhir: kode mati, escape `fileTree`, `__entries` hanya action, dokumen status |

## Progres F7 (fungsi VuGen untuk script KOPRA — `plan-f7.md`)

| Sub-tahap | Status | Isi |
|---|---|---|
| F7a | `[x]` | `lr_exit` — mode 0–4, status PASS/FAIL/AUTO, transaksi terbuka ditutup; iterasi gagal tidak menghentikan run |
| F7b | `[x]` | `web_reg_save_param_json` + subset JSONPath — subset JSONPath sendiri (`jsonpath.js`), SelectAll/Ordinal/NotFound; {param} di nilai header kini disubstitusi |
| F7c | `[x]` | `web_remove_auto_header`, `web_revert_auto_header`, `lr_param_sprintf`, `web_convert_from_formatted` (Base64) — ImplicitGen= diabaikan dengan warning; arah konversi Base64 = encode (diverifikasi dari pemakaian `Basic {basicUsername}`) |
| F7d | `[x]` | `web_concurrent_start/end` (no-op, log debug; request tetap berurutan). AC akhir: fixture `mcm-like` + smoke script nyata (lihat di bawah) |

## Progres U1 (rapikan UI/UX — `prompt-sonnet.md`)

| Tahap | Status | Isi |
|---|---|---|
| U1a | `[x]` | Layout & proporsi (kolom 18/1fr/34%, kolom kiri 38/62, bar opsi satu baris, status badge, scrollbar) — screenshot: scratchpad/u1/before|after (sm=1280x720, lg=1500x900) |
| U1b | `[x]` | Step list (nama transaksi diprioritaskan, kolom durasi rata kanan, badge method, selector iterasi) — nama transaksi 24 karakter utuh di 1500; kolom kiri 20% |
| U1c | `[x]` | Snapshot / Parameter / Log (tab seragam, header snapshot 2 baris, status tanpa '-', log grid) — terverifikasi screenshot 1500x900 |
| U1d | `[x]` | Panel search CodeMirror (gaya aplikasi, label Indonesia, highlight) — dark theme, amber highlight, label ID terverifikasi screenshot 1500x900 |
| U1e | `[x]` | Bug kecil: substituteParams regex (JSON body tidak memicu warn), fetchRunResult race (SSE close dulu), snapshot empty-state + render token |

## Status script referensi (compile + `import()` saja; belum pernah dijalankan ke server target)

Dihitung ulang dengan smoke test `VUGEN_REAL_SCRIPTS` setelah F7d. Semua 9 folder di `D:\Mandiri\KOPRA\R10.1\script` ter-compile dan ter-`import()` tanpa error sintaks.

| Script | Warning | Rincian |
|---|---|---|
| `BP000_VugenWeb` | **0** | `.dat` terbaca: `ip` (1 baris), `subTrans` (1 baris) |
| `BP000_MCM_ViewDashboard` | **0** | (sebelum F7: 12) `.dat` terbaca: `companyId` (1), `ip` (2), `userApprover` (1), `userMaker` (1000 baris) |
| `BP211_Adjustment_UDC_ST`, `BP211_MCM_Adjustment_UDC_ST`, `BP211_MCM_AdjustmentUDC_ST`, `BP601_MenuTransferToAccount_MI_ST`, `BPXXX_Adjustment_UDC_ST` | 4 masing-masing | `lr_unmask` ×2, `web_reg_async_attributes` ×1, `web_stop_async` ×1 (sebelum F7: 90) |
| `BPXXX_STTM_BGN_ST` | 5 | `lr_unmask` ×3, `web_reg_async_attributes` ×1, `web_stop_async` ×1 (sebelum F7: 133) |
| `Recording` | 112 | `compareDuration` dipakai 45× tapi tidak didefinisikan di folder itu (masalah script, bukan transpiler), `web_reg_async_attributes` ×5, `web_stop_async` ×5, `lr_unmask` ×2 (sebelum F7: 186) |

## Known limitations

- **Script KOPRA nyata belum pernah dijalankan ke server target.** Semua uji run memakai mock lokal.
- **Fungsi yang dipakai script KOPRA tapi belum ada** (dipanggil sebagai *unsupported*: warning, lalu dilewati): `lr_unmask` (algoritme mask milik LoadRunner), `web_reg_async_attributes`/`web_stop_async` (polling async), `lr_save_int`, `lr_paramarr_*`. Dampak: password yang dibungkus `lr_unmask` (untuk `web_set_user`) tidak ter-unmask.
- **`web_concurrent_start/end` hanya penanda:** request di antaranya dijalankan **berurutan**, bukan paralel, jadi waktu per blok lebih lama daripada di VuGen dan pola timing berbeda.
- **JSONPath (`web_reg_save_param_json`)** hanya subset: `$`, `.nama`, `..nama`, `[n]`, `[*]`, `['nama']`. Filter `?()`, slice, indeks negatif, dan `.*` memberi error registrasi. `Scope=ALL` diperlakukan sebagai BODY. Objek/array disimpan sebagai JSON ringkas (`JSON.stringify`), bukan teks asli response.
- **`web_convert_from_formatted`** hanya `Extensions=Base64` (encode UTF-8); extension lain: warning dan parameter tidak diisi.
- **`lr_exit`:** mode `LR_EXIT_VUSER` (0) menghentikan iterasi tersisa lalu menjalankan `vuser_end` (sesuai dokumentasi LoadRunner, belum dibandingkan dengan VuGen asli). Transaksi terbuka saat `lr_exit`: `LR_FAIL` → Fail, selain itu Pass/Fail otomatis per transaksi.
- **`web_revert_auto_header`** sama dengan mencabut auto header yang ditambahkan script (runtime ini tidak membuat header implisit seperti VuGen).
- **Parameter:** hanya `.dat` (baris pertama = header, pemisah koma tanpa quote, urut per iterasi, kembali ke awal bila habis). `.prm` tidak dibaca, jadi `Random`/`Unique`/`Time`/`Userid`/`OutOfRangePolicy` tidak ada. Satu VU saja.
- **Compile mengabaikan** `pre_cci.c`, `combined_*.c`, dan semua file di `data/` (artefak VuGen).
- **Subset C:** tidak ada `goto`, `struct`/`typedef`, array multi-dimensi, initializer list, operator pointer (`&`, `*`), dan `strcat`. Pembagian `int / int` memakai semantik JS (hasil pecahan). `char` array/pointer diperlakukan sebagai string JS.
- **`web_js_run`:** `File=` belum didukung; `node:vm` memisahkan scope tapi bukan sandbox keamanan.
- **HTTP:** `web_submit_data` multipart dikirim sebagai urlencoded; tanpa HTTP/2; urutan header tidak identik dengan VuGen.
- **Perilaku error:** step gagal (exception, HTTP ≥ 400, `web_reg_find` tidak terpenuhi) menghentikan iterasi itu; iterasi berikutnya dan `vuser_end` tetap jalan; transaksi yang terputus dicatat `Fail`. `vuser_init` gagal melewati iterasi. Kasus lain yang tidak diverifikasi dengan VuGen asli perlu dicek bila hasilnya berbeda.
- **`run.json`** tidak menyimpan status per iterasi; tanda ✗ di selector iterasi dihitung dari step error / transaksi Fail.
- **Panel Parameter:** tabel Name/Value yang bisa diurutkan menurut nama, dua versi — *Parameter VuGen* (`.dat`, `lr_save_string`, `web_reg_save_param*` boundary/regexp/JSONPath, `lr_param_sprintf`, `web_convert_from_formatted`, `LR.setParam`) dan *Variabel C* (lokal, parameter fungsi, dan global yang terlihat di baris step). Nilai adalah nilai PADA step terpilih. Keterbatasan: perubahan parameter di antara dua step hanya tercatat nilai terakhirnya; variabel C hanya dicatat di pernyataan yang memanggil `web_url`/`web_custom_request`/`web_submit_data`/`web_submit_form`/`web_rest` (bukan di setiap baris); array/struct ditampilkan sebagai JSON ringkas (maks 300 karakter); perubahan parameter sesudah step terakhir hanya terlihat di keadaan akhir run.
- **UI:** tidak ada tab Transactions, README, atau `check:script`.
- **Test:** timeout test dinaikkan ke 20 s karena import dingin sesekali melewati 5 s saat banyak proses paralel.

## Backlog fitur (salinan `plan-stabilisasi.md` §9 — JANGAN dikerjakan di plan stabilisasi)

Fungsi/fitur yang dipakai script KOPRA tapi belum ada — kerjakan nanti dengan plan terpisah:
- (sudah dikerjakan di F7: `lr_exit`, `web_reg_save_param_json`, `web_remove/revert_auto_header`, `web_concurrent_start/end`, `lr_param_sprintf`, `web_convert_from_formatted`) Sisa: `lr_unmask`, `lr_save_int`, `lr_paramarr_*`, `web_reg_async_attributes`/`web_stop_async`, `web_rest` dengan header kompleks.
- Mesin parameter `.prm` lengkap (Type Table/Time/Userid, `SelectNextRow`, `GenerateNewVal`, `OutOfRangePolicy`).
- Tab Transactions, ringkasan transaksi, `npm run check:script`, README, multipart upload, HTTP/2.
- Semua item `plan.md` §2/§10 (recording, multi-VU/k6, Step Toolbox).

---

## Riwayat rinci per tahap (F0–F6)

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

## F2 — Tokenizer + Parser ✅

- `[x]` `server/compiler/tokenizer.js` — string literal + escape (`\"`, `\\`, `\n`, `\x..`), concat literal bersebelahan (termasuk lintas komentar), komentar `/* */` & `//`, makro `LAST`/`ITEMDATA`/`ENDITEM`/`EXTRARES` (identifier biasa), angka (dek/hex/bin + suffix), identifier, punctuation, direktif `#...` + line continuation; tiap token menyimpan `line`, `col`, `start`, `end`
- `[x]` `server/compiler/parser.js` — AST toleran: `Directive`, `FunctionDeclaration`, `BlockStatement`, `ExpressionStatement`, `ReturnStatement`, `IfStatement`, `ForStatement`, `WhileStatement`, `DoWhileStatement`, `BreakStatement`, `ContinueStatement`, `LabeledStatement`, `Unsupported`; ekspresi: `CallExpression` (argumen string/angka/makro/nested call, multi-baris), `Identifier`, `StringLiteral`, `NumberLiteral`, `MemberExpression`, `Unary/Binary/Assignment/Conditional/Update/Sequence`; setiap node punya `file` + `line`; gagal parse → `Unsupported` + warning, lanjut
- `[x]` `server/compiler/__fixtures__/` — 4 fixture (`basic-strings`, `sample-action`, `control-flow`, `unsupported`) + golden `.tokens.json` & `.ast.json`; `server/compiler/test-utils.js` + `scripts/generate-golden.js` (`npm run golden:update`)
- `[x]` Test: `tokenizer.test.js` + `parser.test.js` (golden + escape/concat/komentar/CRLF/direktif/makro/hex-suffix/hirarki/unsupported/warning + ekuivalensi golden pada fixture CRLF) — 27 test → total 51
- `[x]` **AC:** `samples/basic/Action.c` terparse tanpa error; 6 call dengan `file`+`line` benar (3, 5, 11, 20, 22, 24)
- `[x]` Commit `F2: tokenizer + parser call C + golden test` (+ fix kecil: retry rename EPERM/EACCES/EBUSY di `save.js`)

## F3 — Transpile + Runtime inti ✅ (terverifikasi S2–S5)

- `[x]` `server/compiler/transpile.js` — AST → JS internal, penanda `__at("file", line)`, `await` untuk `web_*`/`lr_*`, `__unsupported("asli")`; output ke `.cache/<hash>/build/`
- `[x]` `server/runtime/http-client.js` — undici + tough-cookie + redirect manual (catat hop) + timeout + `insecureTLS`
- `[x]` `server/runtime/vuser-api.js` — 7.1 inti; substitusi `{param}` runtime (tak ketemu → biarkan + warning)
- `[x]` `server/runtime/runner.js` — entry `fork`; init 1× → Action ×N → end 1×; `continueOnError`/`iterationDelayMs`/`newUserEachIteration`/`thinkTime`; kirim event ke parent
- `[x]` `server/runs/store.js` — `@typedef RunResult` (§7.3) + tulis `run.json` + `steps/<seq>.body` (batas 5 MB, flag `truncated`) + decode charset
- `[x]` `server/test/mock.js` — mock `node:http` melayani `/` dan `/login`
- `[x]` `samples/core/` — sampel fungsi F3 saja (`web_url`, `lr_*`, `web_add_header`)
- `[x]` Test: run CLI langsung tanpa UI
- `[x]` **AC:** `run.json` step/status/header/body/transaksi/line benar; unsupported → warning; `iterations=3` → init & end 1×, Action 3×, `iteration` 1..3
- `[x]` Commit: tidak pernah dibuat terpisah (`F3: transpiler + runner fork + penyimpanan hasil run` hanya rencana); kode masuk lewat checkpoint S0 `f2dfb97`

## F4 — UI Run + Snapshot ✅ (terverifikasi S1 + S6)

- `[x]` `server/routes/run.js` — `POST /api/run`, `GET /api/run/:id/events` (SSE), `POST /api/run/:id/stop`, `GET /api/run/:id`, `GET /api/run/:id/step/:seq/body`
- `[x]` `src/components/stepList.js` + selector iterasi (1..N)
- `[x]` `src/components/snapshotPanel.js` — iframe `sandbox=""` srcdoc, CSP `default-src 'none'`, toggle "Load resources"
- `[x]` Panel Request / Response / Parameter / Log
- `[x]` Sinkron klik step ↔ baris editor (dua arah)
- `[x]` Kontrol jumlah iterasi + opsi run di toolbar; indikator status
- `[x]` **AC:** Run → step live → snapshot tampil; Stop <2s tanpa proses yatim; error menunjuk baris C benar; restart Vite bersih
- `[x]` Commit: tidak pernah dibuat terpisah (`F4: UI run live + snapshot + panel` hanya rencana); kode masuk lewat checkpoint S0 `f2dfb97`

## F5 — Fungsi lanjut ✅ (terverifikasi S2–S5)

- `[x]` `web_submit_data` (ITEMDATA/ENDITEM), `web_submit_form` (sederhana)
- `[x]` `web_reg_save_param`, `web_reg_save_param_ex`, `web_reg_save_param_regexp`
- `[x]` `web_reg_find`
- `[x]` `web_add_cookie`, `web_cleanup_cookies`, `web_set_user`
- `[x]` **AC:** login 3 langkah dengan correlation (token step 1 dipakai step 2); tab Parameter menampilkan nilai correlation
- `[x]` Commit: tidak pernah dibuat terpisah (`F5: web_submit_data + correlation + cookie` hanya rencana); kode masuk lewat checkpoint S0 `f2dfb97`

## F6 — Parameter file + control flow (opsional) ◑ (`.dat` + control flow selesai; `.prm` backlog)

- `[x]` Parameter `.prm`/`data/*.dat` (sequential, ganti per iterasi)
- `[x]` Subset C: `if/else/for/while`, `int`, `char*`, `strcmp`, `sprintf`, `atoi`, `strcpy`
- `[x]` **AC:** script sampel dengan loop + if berjalan sesuai ekspektasi
- `[x]` Commit: tidak pernah dibuat terpisah (`F6: parameter file + subset control flow C` hanya rencana); kode masuk lewat checkpoint S0 `f2dfb97`

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