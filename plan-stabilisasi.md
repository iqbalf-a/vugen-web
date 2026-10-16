# Plan Stabilisasi VuGen Web — Bersihkan & Perbaiki (S0–S7)

> Instruksi kerja untuk AI agent (dieksekusi sesi lain, model Sonnet).
> Revisi 2 — 2026-10-16. **Fokus: perbaiki bug dan rapikan kode yang SUDAH ADA. Jangan tambah fitur baru.**
> `plan.md` tetap spesifikasi produk. Fitur yang belum ada dicatat di §9 Backlog dan **tidak dikerjakan**.

---

## 0. Cara mengeksekusi plan ini (WAJIB dibaca dulu)

1. Kerjakan tahap **berurutan**. Satu tahap = satu commit. **Berhenti di akhir setiap tahap** dan laporkan hasil AC sebelum lanjut.
2. **Definisi "bukan fitur baru":** boleh memperbaiki fungsi/komponen yang sudah ada agar bekerja sesuai `plan.md` atau sesuai perilaku VuGen yang jelas; boleh menghapus kode mati/duplikat; boleh menambah test. **Tidak boleh** menambah fungsi VuGen baru, endpoint baru, tab/panel UI baru, opsi baru, atau dependency baru. Bila sebuah perbaikan terasa butuh fitur baru → berhenti, catat di §9, tanya user.
3. Sebelum commit, ketiganya wajib hijau:
   ```
   npx vitest run
   npx eslint .
   node server/test/run-cli.js samples/f5 1     # mulai S2: exit 0 dan menulis run.json
   ```
4. Aturan keras `plan.md` §4 tetap berlaku (folder script read-only, artefak ke `.cache/`, save atomic, unsupported → warning, kill child process).
5. **Folder `D:\Mandiri\...` read-only total.** Jangan salin IP, user, token, URL bank, atau isi `.dat` ke repo. Fixture uji dibuat **sintetis**.
6. Ikuti gaya kode sekitar: vanilla JS ESM, JSDoc, komentar bahasa Indonesia, tanpa `console.log` debug di kode yang di-commit.
7. **Hati-hati entitas HTML:** setelah menulis kode yang memuat `&amp;`, `&lt;`, `&gt;`, `&quot;`, verifikasi isi file dengan `grep -n "&amp;" <file>` — di repo ini pernah terjadi entitas berubah jadi karakter mentah sehingga escape tidak bekerja.
8. Pesan commit format `S<n>: <ringkas>`; akhiri dengan baris atribusi yang diminta sistem. Update `todo.md` di commit yang sama.

---

## 1. Status

| Tahap | Isi | Status |
|---|---|---|
| S0 | Bersihkan working tree, lint 0, checkpoint F3–F6 | **selesai** (`f2dfb97`) |
| S1 | Keamanan UI: escape HTML + snapshot di iframe sandbox | **selesai** (`a6185cc`) |
| S2 | Jalur step & penyimpanan run end-to-end | **selesai** |
| S3 | Lifecycle child process, SSE, routing | **selesai** |
| S4 | Transpiler: perbaiki subset C yang sudah diklaim | **selesai** |
| S5 | Runtime: perbaiki fungsi yang sudah ada | **selesai** |
| S6 | Loader parameter `.dat` + rapikan frontend | belum |
| S7 | Rapikan akhir + dokumentasi status jujur | belum |

---

## 2. Temuan (bukti dari analisis kode setelah S0)

**Kritis — keamanan**
- **K1** `escapeHtml` di 6 file (`src/components/{logPanel,parameterPanel,requestPanel,responsePanel,snapshotPanel,stepList}.js`) **tidak melakukan apa-apa**: `.replace(/&/g, "&")`, `.replace(/</g, "<")`, dst. Semua data dari server target (nama step, URL, header, log, nilai correlation) masuk ke `innerHTML` tanpa escape.
- **K2** Snapshot HTML **tidak memakai iframe**. `snapshotPanel.js` `renderContent()` membangun dokumen HTML lengkap lalu menyisipkannya lewat `root.innerHTML`. Meta CSP di dalamnya tidak berlaku. Akibatnya HTML dari server target (mis. `<img src=x onerror=...>`) berjalan di origin aplikasi yang punya `PUT /api/file` (bisa menimpa script) dan `POST /api/run`. Melanggar `plan.md` §7.5. Toggle "Load resources" tidak pernah aktif (`loadResources` selalu `false`).

**Tinggi — fungsi inti tidak bekerja**
- **T1** `vuser-api.js` `handleResponse`: tidak pernah mengirim event `step`; log info ditulis **dua kali**; `request` diisi tebakan (`method: "GET"/"UNKNOWN"` dari `redirectChain`).
- **T2** `server/test/run-cli.js`: `saveRun` tidak di-`await` sebelum `process.exit()` → `run.json` tidak pernah tertulis (terverifikasi).
- **T3** Dua mekanisme body paralel: `steps/<seq>.body` dan `snapshots/<nama>.body` (nama dari `Snapshot=t1.inf`). Snapshot berkunci nama → iterasi 2 menimpa iterasi 1. `addSnapshot` memanggil `saveSnapshotBody` tanpa `await` (promise lepas). Nama snapshot dari script dipakai langsung sebagai nama file.
- **T4** `runId`/`seq`/`name` dari URL dipakai di `path.join` tanpa validasi (`server/routes/run.js`, `server/runs/store.js`).
- **T5** UI memanggil `GET /api/run/:id` saat event `done`, padahal `saveRun` di parent belum selesai (race → 404 / data lama).
- **T6** `server/routes/run.js` punya `runningChildren` sendiri; `registerRun/killAllRuns` di `server/vite-plugin.js` tidak dipakai siapa pun → child yatim saat Vite restart. Fork path `path.resolve("server/runtime/runner.js")` bergantung cwd. Runner `import(\`file://${modulePath}\`)` salah di Windows.
- **T7** SSE: polling `setInterval` 1 dtk + heartbeat tiap 1 dtk, `startSse()` di `http-utils.js` tidak dipakai; `pendingEvents` tidak pernah dihapus. Endpoint `/run/:id/debug` sisa debugging. Routing dobel: daftar route di `routes/index.js` **dan** dispatch manual di `handleRunRoutes`.
- **T8** Event dibungkus aneh: step & transaksi dikirim sebagai `log` level `"step"`/`"transaction"` berisi string JSON; UI (`main.js`) melacak transaksi dengan mem-parse teks log `"lr_start_transaction: "`. Event SSE `transaction` di UI melakukan `JSON.parse(data.data)` (akan crash).

**Tinggi — transpiler**
- **T9** If/For/While/DoWhile: kondisi = teks C mentah (`header.raw`) + regex makro. Panggilan fungsi di kondisi tidak diberi `__vu.`/`await` → `ReferenceError`.
- **T10** Deklarasi: hanya regex satu variabel; `double a=0, b=0;` → unsupported; init (`int x = atoi(...)`) disalin mentah. Global di `globals.h` diabaikan lalu **di-hardcode** `let startTime = 0;`.
- **T11** Akhir `statementToJs`: kurung salah tempat → node non-`Unsupported` yang jatuh ke default mengembalikan `undefined` → crash di `flatMap/map`.
- **T12** `CORE_FUNCTIONS` (transpile.js) tidak sinkron dengan export `vuser-api.js`: `lr_start_timer`, `lr_end_timer`, `web_js_run`, `web_set_sockets_option`, `web_set_max_html_param_len`, `web_cleanup_auto_headers` **sudah diimplementasi** tapi ditranspile sebagai *unsupported*. (Script KOPRA memakai `lr_start_timer/lr_end_timer` 2082×.)
- **T13** `LR_PASS/LR_FAIL/LR_AUTO/LR_EXIT_*` ditranspile jadi string, sedangkan `lr_get_transaction_status` mengembalikan angka → `== LR_FAIL` selalu false.
- **T14** `strcpy(buf, src)` hanya mengembalikan `src`; `buf` tidak berubah. `sprintf(buf, ...)` sama. (Keduanya diklaim didukung di F6.)

**Sedang — runtime (fungsi yang sudah ada)**
- **R1** `web_js_run`: hanya `Code=` terakhir yang dipakai; blok `SOURCES ... ENDITEM` diabaikan → pola KOPRA (`Code= myFunc(...)` + definisi di SOURCES) tidak pernah jalan → `{subTrans}` kosong. Memakai `new Function` (tanpa batas waktu).
- **R2** `web_add_header` = `web_add_auto_header` (keduanya permanen). Lalu `__resetHeaders()` tiap iterasi baru menghapus auto header dari `vuser_init`.
- **R3** `web_add_cookie`: memakai `http.lastUrl` sebagai domain (atribut `DOMAIN=` diabaikan), `addCookie` tidak di-`await`, `{param}` tidak disubstitusi, error ditelan diam-diam.
- **R4** `sprintf`: `%%` ikut mengonsumsi argumen (geser semua argumen sesudahnya); presisi `%.2f` salah parse; lebar `%5s`/`%05d` diabaikan. `lr_output_message`/`lr_error_message` hanya mengganti `%s`.
- **R5** Transaksi: hanya satu transaksi aktif; `LR_AUTO` dicatat apa adanya (bukan Pass/Fail); event transaksi tanpa `iteration`. `lr_get_transaction_status` mengembalikan 0/1 berdasarkan "sedang aktif", bukan status.
- **R6** HTTP status ≥ 400, `web_reg_find` gagal, dan exception request **tidak** menggagalkan step/transaksi → opsi `continueOnError` tidak bermakna.
- **R7** Regex correlation tidak dijaga (`new RegExp` invalid → crash request). `default export` di `vuser-api.js` usang/tidak lengkap dan tidak dipakai.
- **R8** `http-client.js`: indentasi blok `while` rusak (L203–240); opsi `connectTimeout` bukan opsi `undici.request` (diabaikan); kode mati `setCookieJar/getCookieJar/createHttpClientFromState`, `cleanupCookies` duplikat `clearCookies`.

**Sedang — loader & frontend**
- **L1** `loader.js` `loadParameterFiles` memperlakukan `.prm` (format INI `[parameter:x]`) sebagai CSV → menghasilkan param sampah bernama file `.prm`.
- **L2** `.dat`: baris header hanya dibuang bila **persis** sama dengan nama file. Script nyata: `companyid.dat` berheader `companyId` → header ikut jadi nilai, dan nama param jadi `companyid` (tidak cocok dengan `{companyId}`). File multi-kolom tidak didukung padahal formatnya CSV berheader.
- **L3** `GET /api/project` mengembalikan `parameterFiles` berupa `Map` → ter-serialisasi `{}`.
- **F1** `src/components/requestPanel.js` dan `responsePanel.js` tidak di-import di mana pun (kode mati; tab Request/Response sebenarnya dirender di `snapshotPanel.js`).
- **F2** State iterasi terpilih ada di dua tempat (`selectedIteration` modul `stepList.js` vs `store.selectedIteration` yang tidak pernah di-set). Event `stepSelect` ikut menimpa `currentRun`.

---

## S1 — Keamanan UI (K1, K2, F1)

- [x] Buat `src/utils/html.js` berisi satu `escapeHtml(value)` yang benar (`& < > " '` → entitas). Hapus 6 salinan lokal, import dari util ini. Verifikasi dengan `grep -n "&amp;" src/utils/html.js`.
- [x] Audit setiap `innerHTML` di `src/`: setiap nilai yang berasal dari run/server/file wajib lewat `escapeHtml`. Nilai yang ditaruh di atribut (`title`, `data-*`) juga.
- [x] Snapshot HTML dirender dalam `<iframe sandbox="" srcdoc="...">` yang dibuat via DOM API (`iframe.srcdoc = doc`), **bukan** disisipkan ke `innerHTML` aplikasi. Default CSP sesuai `plan.md` §7.5. Toggle "Load resources" yang sudah ada dihubungkan ke state lokal panel (ON → sisipkan `<base href>` + CSP longgar; iframe tetap `sandbox=""` tanpa `allow-scripts`).
- [x] Hapus `src/components/requestPanel.js` dan `responsePanel.js` (tidak dipakai).
- [x] Test `src/utils/html.test.js` (Vitest, tanpa DOM): escape lima karakter + nilai non-string.

**AC:** `grep -rn "function escapeHtml" src` → hanya 1 hasil; buat step palsu dengan nama `<img src=x onerror=alert(1)>` (mis. lewat mock) → tampil sebagai teks; body HTML mock yang berisi `<script>` tidak tereksekusi (cek manual di browser, jelaskan langkahnya).

---

## S2 — Jalur step & penyimpanan run (T1–T5, T8 sisi server)

Desain (ikuti, jangan improvisasi):
- **Runner** memberi `seq` (counter, mulai 1) dan **runner** menulis body ke `<cacheDir>/runs/<runId>/steps/<seq>.body` (payload start sudah membawa `cacheDir`, `runId`). Batas 5 MB → potong + `truncated: true`. Lewat IPC hanya metadata, tanpa Buffer.
- Event IPC/SSE berbentuk objek langsung: `step` (bentuk `StepResult` di `store.js`), `transaction` (`{iteration, name, status, durationMs}`), `log` (`{level, msg, file, line, iteration}`), `iterationStart/End`, `started`, `done`. **Hapus** level log `"step"`/`"transaction"` dan payload string JSON.
- Nama snapshot (`Snapshot=t1.inf`) disimpan hanya sebagai field `step.snapshot` (metadata). **Hapus** mekanisme `snapshots/` (`saveSnapshot`, `snapshotStore`, `__getAllSnapshots`, `snapshotsComplete`, `snapshotMeta`, `addSnapshot`, `saveSnapshotBody`, `loadSnapshotBody`, endpoint `/run/:id/snapshot/:name/body`). Body selalu lewat `GET /api/run/:id/step/:seq/body`.
- `request` diisi dari request **asli** (method, URL final, header gabungan termasuk Cookie, `bodyPreview` ≤ 2 KB). `response.redirects` = hop dari `redirectChain`. `timing.startMs` relatif awal run.
- `store.js` `decodeBody` dipakai saat runner membuat teks untuk correlation/`web_reg_find` (ganti `toString("utf8")` langsung), atau dihapus bila tidak terpakai — pilih salah satu, jangan biarkan mati.

Langkah:
- [x] Ekstrak logika "compile + fork + akumulasi event + saveRun" yang terduplikasi di `server/routes/run.js` dan `server/test/run-cli.js` ke `server/runs/execute.js` (`startRun({scriptDir, options}) → { runId, child, events: EventEmitter, done: Promise<RunResult> }`). `done` resolve **setelah** `saveRun` selesai. Event `done` ke SSE dikirim **setelah** `saveRun` (perbaiki T5).
- [x] `run-cli.js` memakai `execute.js` dan `await done`.
- [x] Validasi `runId` (`/^[0-9TZ-]+-[0-9a-f]{8}$/` sesuai `generateRunId`) dan `seq` (integer > 0) sebelum menyentuh filesystem → 400 bila tidak valid.
- [x] Test `server/test/run.f5.test.js` (tulis dulu, harus merah): mock di port tetap 18081 (sample memakai URL itu; set `fileParallelism: false` untuk file ini atau pakai `describe.sequential`), jalankan `samples/f5`, assert: status `passed`; jumlah step = jumlah request di `samples/f5/Action.c`; `file`/`line` sesuai baris C; `request.method` `POST` untuk login; `steps/1.body` berisi HTML mock; `params.csrf` terisi dan body login memuat nilai itu; check `web_reg_find` `passed`; `transactions` memuat `T01_home` & `T02_dashboard`.
- [x] Test `iterations=3` pada `samples/core`: `vuser_init`/`vuser_end` 1×, step Action ber-`iteration` 1..3.

**AC:** dua test baru hijau; `node server/test/run-cli.js samples/f5 1` menulis `run.json`; `grep -rn "snapshotsComplete\|level === \"step\"" server src` → kosong.

---

## S3 — Lifecycle child, SSE, routing (T6, T7)

- [x] Pindahkan registri child dari `server/vite-plugin.js` ke `server/runs/registry.js`; `vite-plugin.js` dan `execute.js` mengimpor dari sana. Hapus `runningChildren` di `routes/run.js`.
- [x] Fork path: `fileURLToPath(new URL("../runtime/runner.js", import.meta.url))`. Runner: `import(pathToFileURL(modulePath).href + "?t=" + Date.now())`.
- [x] Stop: kirim `{type:"stop"}`, fallback `child.kill()` setelah 1500 ms; status run `"stopped"`; `run.json` tetap tersimpan.
- [x] SSE pakai `startSse()` (heartbeat 15 s) + push dari `EventEmitter` (`execute.js`), replay event yang sudah ada saat klien terhubung, unsubscribe saat `req` close, tutup stream setelah `done`. Hapus polling `setInterval`.
- [x] Event run dibuang dari memori 5 menit setelah `done`.
- [x] Routing satu lapis: `routes/index.js` mendaftarkan handler spesifik (`handleRunPost`, `handleRunEvents`, …) dengan parameter path hasil match; hapus dispatch manual `handleRunRoutes` dan endpoint `/run/:id/debug`.
- [x] Hapus `console.log` operasional di `routes/run.js` (stdout/stderr runner boleh diteruskan ke log run level `debug`).
- [x] Test: mock endpoint lambat → stop → child `exit` < 2 s, status `stopped`; `killAllRuns()` membunuh semua child.

**AC:** test hijau; `grep -rn "runningChildren" server` → hanya di `registry.js`; manual: ubah `vite.config.js` di tengah run → tidak ada proses runner tersisa (beri user perintah PowerShell `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? CommandLine -match 'runner.js'`).

---

## S4 — Transpiler (T9–T14)

Kerjakan TDD dengan golden. Golden F2 lama tidak boleh berubah kecuali karena node baru — jelaskan tiap perubahan golden di laporan.

- [x] Parser: header control-flow juga diparse jadi ekspresi (`IfStatement.test`, `WhileStatement.test`, `DoWhileStatement.test`, `ForStatement.init/test/update`); `header.raw` tetap disimpan untuk pesan. Gagal parse → `Unsupported` + warning.
- [x] Parser: `VariableDeclaration` multi-deklarator (`double a=0, b, c[256];`, pointer `char *p`) di dalam fungsi dan top-level. Tipe: `int char short long float double unsigned signed const static merc_timer_handle_t size_t`.
- [x] `#include` header LoadRunner (`lrun.h`, `web_api.h`, `lrw_custom_body.h`, `as_web.h`) dan `#ifndef/#define/#endif` → diabaikan tanpa warning.
- [x] Transpiler: hapus `replaceCoreFunctions` & semua jalur teks mentah; kondisi/inisialisasi lewat `expressionToJs`. Global → `let` level modul. **Hapus** hardcode `let startTime = 0;`. Perbaiki T11 (selalu kembalikan array).
- [x] T12: satu sumber kebenaran daftar fungsi yang didukung — buat `server/runtime/api-names.js` yang mengekspor `SUPPORTED_FUNCTIONS` (nama export `vuser-api.js` tanpa awalan `__`), dipakai transpiler; tambah test yang memastikan setiap nama di daftar benar-benar diekspor `vuser-api.js` dan sebaliknya.
- [x] T13: makro status jadi angka (`LR_PASS=0, LR_FAIL=1, LR_AUTO=2, LR_STOP=3`, `LR_EXIT_VUSER=0, LR_EXIT_ACTION_AND_CONTINUE=1, LR_EXIT_ITERATION_AND_CONTINUE=2, LR_EXIT_VUSER_AFTER_ITERATION=3, LR_EXIT_VUSER_AFTER_ACTION=4`); makro argumen web (`LAST ITEMDATA ENDITEM EXTRARES SOURCES SEARCH_FILTERS`) tetap sentinel string. Runtime menerima angka maupun string lama.
- [x] T14: bila argumen pertama `Identifier`: `strcpy(d, s)` → `d = String(s)`, `strcat(d, s)` → `d = d + s`, `sprintf(d, f, ...)` → `d = await __vu.sprintf(f, ...)`. Lainnya → warning unsupported. (`strcat` hanya bila sudah ada di runtime; jika belum, cukup `strcpy`/`sprintf` — jangan tambah fungsi.)
- [x] Fixture sintetis `__fixtures__/kopra-loadpage.c` + `kopra-globals.h` meniru **pola** script KOPRA (deklarasi multi, `char buf[256]`, `startTime = lr_start_timer(); tempSeq = lr_end_timer(startTime); seq1 = compareDuration(seq1, tempSeq);`, `if (lr_get_transaction_status(lr_eval_string("{transName}")) == LR_FAIL) { ... }`). Lihat contoh nyata read-only di `D:\Mandiri\KOPRA\R10.1\script\BP211_Adjustment_UDC_ST\Loadpage.c` dan `globals.h`; jangan salin isinya.
- [x] Test: golden JS + `import()` hasil transpile setiap fixture (tulis ke temp dir) untuk memastikan sintaks valid.
- [x] Smoke test opsional (skip bila env tidak di-set): `VUGEN_REAL_SCRIPTS=<folder>` → compile + `import()` setiap subfolder; jangan commit output.

**AC:** golden hijau; `VUGEN_REAL_SCRIPTS="D:/Mandiri/KOPRA/R10.1/script" npx vitest run` → semua script ter-`import()` tanpa error sintaks (laporkan jumlah lulus/gagal); `grep -n "startTime" server/compiler/transpile.js` → kosong.

---

## S5 — Runtime: perbaiki fungsi yang sudah ada (R1–R8)

Tidak ada fungsi baru. Setiap perbaikan disertai unit test terhadap mock.

- [x] R1 `web_js_run`: eksekusi semua `Code=` di blok `SOURCES ... ENDITEM` lebih dulu, lalu `Code=` utama, dalam satu `vm.createContext({ LR })` dengan `timeout` 1000 ms. Pertahankan `LR.getParam/setParam` yang ada.
- [x] R2 Header: pisahkan `autoHeaders` (permanen; `web_add_auto_header`, `web_cleanup_auto_headers`) dan `nextHeaders` (`web_add_header`, dipakai lalu dikosongkan setelah satu request). Iterasi baru dengan `newUserEachIteration` hanya membersihkan cookie + `nextHeaders`, **bukan** auto header.
- [x] R3 `web_add_cookie`: substitusi `{param}`, ambil `DOMAIN=` dari string untuk URL konteks (fallback `lastUrl`), `await` penyimpanan, log `warn` bila cookie ditolak.
- [x] R4 `sprintf`: perbaiki `%%`, presisi, lebar & padding nol untuk `%s %d %i %f %c`. `lr_output_message`/`lr_error_message` memakai `sprintf` yang sama. Test tabel kasus.
- [x] R5 Transaksi: `Map<name, {startMs, failed}>` (bersarang diizinkan); `lr_end_transaction(name, LR_AUTO)` → `Pass`/`Fail` tergantung ada step gagal sejak start; status eksplisit dihormati; event transaksi membawa `iteration`. `lr_get_transaction_status(name)` → `LR_FAIL` bila transaksi itu sudah tercatat gagal, selain itu `LR_PASS`. `step.transaction` = transaksi terdalam yang terbuka.
- [x] R6 Step gagal bila: exception request, status ≥ 400, atau `web_reg_find` tidak terpenuhi → isi `step.error`, tandai transaksi aktif gagal; lalu lempar error ke runner kecuali `continueOnError` (perilaku default VuGen: action gagal).
- [x] R7 Regex correlation invalid → log `error` + step error, bukan crash. Hapus `default export` usang di `vuser-api.js`.
- [x] R8 `http-client.js`: rapikan indentasi `doRequest`, hapus opsi `connectTimeout` yang tidak berlaku (atau pakai `Agent({ connect: { timeout } })` yang sudah dibuat), hapus `setCookieJar/getCookieJar/createHttpClientFromState`, gabungkan `cleanupCookies` ke `clearCookies`. Ukur `durationMs` per request dengan benar.
- [x] Bersihkan `runner.js`: blok parameter-file inisialisasi/advance dipindah ke fungsi kecil; status iterasi/akhir konsisten (`passed|failed|stopped`).

**AC:** fixture `kopra-loadpage.c` dijalankan ke mock: `{subTrans}` terisi dari `web_js_run`, nama step tanpa `{...}`, timer + `compareDuration` menghasilkan angka > 0; transaksi dengan step 500 berstatus `Fail` dan `lr_get_transaction_status` mengembalikan `LR_FAIL`; header `web_add_header` hanya ada di request pertama sesudahnya.

---

## S6 — Loader parameter + rapikan frontend (L1–L3, F2, T8 sisi UI)

Loader (perbaikan perilaku yang ada, bukan mesin `.prm` baru):
- [ ] Hapus parsing `.prm` sebagai CSV (L1). `.prm` tidak dibaca dulu (lihat backlog).
- [ ] `.dat` (L2): baris pertama **selalu** header; pisah dengan koma; setiap kolom header jadi nama param (case-sensitive, trim); nilai = baris berikutnya; baris kosong dilewati. Pertahankan perilaku iterasi sequential + wrap yang sudah ada. Sesuai memori user: `.dat` seperti `ip.dat`/`subTrans.dat` sudah berisi nilai — tidak perlu `lr_save_string`.
- [ ] L3: `GET /api/project` mengembalikan `parameters: [{ name, file, rows }]` (array biasa), bukan `Map`. Runner menerima bentuk yang sama.
- [ ] Test loader dengan fixture sintetis: header beda kapitalisasi dari nama file, multi-kolom, CRLF, baris kosong di akhir.

Frontend:
- [ ] `main.js` mengonsumsi event bentuk baru dari S2 (`step`, `transaction`, `log`, `done`); hapus pelacakan transaksi lewat parse teks log dan `JSON.parse(data.data)`.
- [ ] Setelah `done`, ambil `run.json` (aman karena S2 menjamin sudah tersimpan).
- [ ] F2: iterasi terpilih hanya di `store` (`selectedIteration`); `stepList.js` membaca/menulis store, bukan variabel modul. `stepSelect` tidak lagi menimpa `currentRun`.
- [ ] Hapus handler kosong (`stepHighlight` di `main.js`) dan kode tak terpakai yang ditemukan eslint/grep.

**AC:** test loader hijau; manual `npm run dev` + mock: run `samples/f5` → step live dengan baris & durasi, klik step → snapshot di iframe, ganti iterasi bekerja, editor lompat ke baris; tidak ada error di console browser.

---

## S7 — Rapikan akhir

- [ ] `npx eslint .` 0; hapus file/ekspor yang tidak dipakai (`grep` setiap `export` di `server/` dan `src/` yang tidak di-import di mana pun, kecuali API publik test).
- [ ] Pastikan tidak ada `console.log` di `server/` dan `src/` selain error nyata.
- [ ] `todo.md`: status F3–F6 & S1–S7 jujur, daftar known limitations, salin §9 Backlog.
- [ ] Laporkan ke user ringkasan perubahan S1–S7 dan apa yang masih belum bisa jalan pada script KOPRA (berdasarkan smoke test S4 dan warning unsupported).

**AC:** semua test hijau; user setuju status di `todo.md`.

---

## 9. Backlog fitur (JANGAN dikerjakan di plan ini)

Fungsi/fitur yang dipakai script KOPRA tapi belum ada — kerjakan nanti dengan plan terpisah setelah S7:
- `lr_exit` (36×), `web_reg_save_param_json` (50×), `web_remove_auto_header` (26×), `web_concurrent_start/end` (337×, cukup no-op), `lr_unmask`, `lr_param_sprintf`, `lr_save_int`, `lr_paramarr_*`, `web_reg_async_attributes`/`web_stop_async`, `web_convert_from_formatted`, `web_revert_auto_header`, `web_rest` dengan header kompleks.
- Mesin parameter `.prm` lengkap (Type Table/Time/Userid, `SelectNextRow`, `GenerateNewVal`, `OutOfRangePolicy`).
- Tab Transactions, ringkasan transaksi, `npm run check:script`, README, multipart upload, HTTP/2.
- Semua item `plan.md` §2/§10 (recording, multi-VU/k6, Step Toolbox).

## Risiko

- Parser header control-flow (S4) paling rawan regresi — golden test dulu.
- Perilaku error VuGen (S5 R6) bisa beda tipis; bila ragu, tanya user.
- `.cache/` berisi token/kredensial saat script bank dijalankan; tetap di `.gitignore`.
