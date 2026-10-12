# VuGen Web — Run Script + Snapshot

Dokumen ini adalah instruksi kerja untuk AI agent. Kerjakan berurutan per tahap, centang checklist, dan jangan lompat tahap.

## 1. Tujuan

Aplikasi web lokal (Vite, satu proses) yang:
1. Membuka **satu folder script VuGen** apa adanya (format C).
2. Menampilkan dan mengedit file `.c` (format VuGen tetap dipertahankan).
3. **Menjalankan script** (Run Logic, jumlah iterasi bisa diatur, 1 virtual user) lewat konversi C → JS **di background**. User tidak pernah melihat JS.
4. Menampilkan **Snapshot hasil Run** per step (seperti tab Snapshot di VuGen), plus request, response, parameter, dan log.

## 2. Scope

**Masuk (sekarang):**
- Loader folder script, editor `.c`, Run dengan setting jumlah iterasi (default 1), Stop, log live, snapshot per step.
- Fungsi VuGen inti (lihat 7.1).

**Tidak masuk (jangan dikerjakan):**
- Recording (tidak ada recorder, tidak membaca snapshot hasil rekaman `data/tN.inf`).
- Multi-VU dan k6. Tool ini untuk scripting 1 user, sama seperti VuGen.
- Step Toolbox (tahap lanjutan, lihat bagian 10).
- Mengubah struktur folder script VuGen.
- TypeScript, React, Express (lihat bagian 3).

## 3. Keputusan teknis (final, jangan ditanyakan ulang)

Gaya proyek mengikuti `loadrunner-raw-loader`: vanilla JS, Tailwind v4, backend sebagai Vite plugin middleware.

| Hal | Keputusan |
|---|---|
| App | Vite + **plugin middleware Vite** (`configureServer`). Satu proses, satu perintah `npm run dev`. Tanpa Express, tanpa `concurrently`, tanpa proxy `/api` |
| Bahasa | **Vanilla JavaScript (ES modules)**. Tanpa TypeScript, tanpa React. Tipe didokumentasikan lewat JSDoc (`@typedef`) di tempat bentuk data penting, misalnya `run.json` |
| Styling | Tailwind CSS v4 lewat `@tailwindcss/vite` |
| Struktur UI | Komponen berupa fungsi/modul ES (`createX(root, store)`) dengan `store.js` kecil (state + subscribe). Tanpa framework |
| Editor | CodeMirror 6 (`@codemirror/lang-cpp` untuk mode C) |
| Engine run | Runtime Node sendiri, 1 virtual user (tanpa k6, tanpa multi-VU). Pakai `undici` untuk HTTP dan `tough-cookie` untuk cookie jar |
| Isolasi run | Setiap run dijalankan di `child_process.fork` (file `.js` langsung, tanpa `tsx`) agar server dev tetap responsif dan proses bisa di-kill (Stop) |
| Realtime | Server-Sent Events (SSE) lewat `res.write` |
| Test | Vitest, golden file untuk tokenizer, parser, dan transpiler |
| Platform | Harus jalan di Windows (path `\`, spasi di path, CRLF di file `.c`). Gunakan `node:path` dan `pathToFileURL` untuk fork/import |
| Mode | **Hanya dev lokal** (`npm run dev`). Middleware tidak perlu aktif di `vite build`/`preview` |

## 4. Aturan keras (wajib)

1. **Folder script bersifat read-only**, kecuali satu aksi: user menekan Save pada file `.c`/`.h` yang ia edit. Jangan pernah membuat, mengubah, atau menghapus file lain di folder script.
2. Semua artefak (JS hasil konversi, hasil run, body response, backup) ditulis ke folder cache **di luar** folder script: `<app>/.cache/<hash-path-script>/`.
3. Save wajib atomic (tulis ke temp lalu rename), pertahankan line ending asli file (CRLF/LF) dan encoding asli. Sebelum menimpa, simpan backup ke cache.
4. Jangan menebak format file VuGen. Jika ragu, baca contoh script nyata di folder `samples/`, atau tanyakan ke user.
5. Fungsi yang belum didukung **tidak boleh membuat run crash**: catat warning (file, baris, nama fungsi), lewati statement, lanjutkan.
6. Commit kecil per tahap, dengan pesan jelas.
7. **Watcher Vite wajib mengabaikan** `.cache/` dan folder script (`server.watch.ignored`). Tanpa ini, file hasil run atau Save memicu reload di tengah run.
8. Child process run wajib di-kill bersih saat `server.httpServer` close, saat Vite restart, dan saat proses Node keluar. Tidak boleh ada proses yatim.

## 5. Struktur proyek

```
vugen-web/
├─ package.json
├─ vite.config.js            # plugins: [tailwindcss(), vugenPlugin()], server.watch.ignored
├─ index.html
├─ plan.md
├─ samples/                  # script VuGen contoh (disediakan user)
├─ server/
│  ├─ vite-plugin.js         # configureServer: daftarkan middleware /api
│  ├─ http-utils.js          # parse query (URL), baca body JSON, sendJson, sendError, SSE helper
│  ├─ routes/                # handler gaya Connect (req, res): project, file, run
│  ├─ project/loader.js      # baca folder script (.usr, default.usp, *.c, *.h)
│  ├─ compiler/
│  │  ├─ tokenizer.js
│  │  ├─ parser.js           # C subset -> AST
│  │  ├─ transpile.js        # AST -> JS (internal)
│  │  └─ *.test.js           # golden tests (Vitest)
│  ├─ runtime/
│  │  ├─ runner.js           # entry child process (fork)
│  │  ├─ vuser-api.js        # web_*, lr_* implementasi
│  │  └─ http-client.js      # undici + cookie jar + redirect manual
│  ├─ runs/store.js          # simpan hasil run di cache
│  └─ test/mock.js           # mock server kecil untuk tes
├─ src/                      # frontend vanilla
│  ├─ main.js
│  ├─ style.css              # @import "tailwindcss";
│  ├─ store.js               # state + subscribe
│  ├─ api.js                 # fetch + EventSource
│  └─ components/            # fileTree.js, editor.js, runToolbar.js, stepList.js, snapshotPanel.js, logPanel.js
└─ .cache/                   # gitignore
```

## 6. Input: folder script VuGen

Biasanya berisi: `*.usr`, `default.cfg`, `default.usp`, `vuser_init.c`, `Action.c`, `vuser_end.c`, `globals.h`, `*.prm`, `data/`, `extra files`.

- Daftar action dan urutan Run Logic dibaca dari `.usr` / `default.usp`. **Verifikasi formatnya dengan sampel nyata**; jangan berasumsi. Fallback jika tidak terbaca: `vuser_init.c` → `Action.c` → `vuser_end.c`.
- Eksekusi: `vuser_init` sekali, lalu Action sebanyak jumlah iterasi (default 1), lalu `vuser_end` sekali.
- Setting run (mirip Run-time Settings VuGen): jumlah iterasi, lanjut/berhenti saat error, jeda antar iterasi, think time (`ignore|run`), dan "simulasikan user baru tiap iterasi" (default aktif: cookie dibersihkan di awal tiap iterasi, seperti default VuGen).
- Variabel param hasil `lr_save_string`/correlation dihitung per iterasi; nilai yang disimpan dengan `lr_save_string` boleh bertahan antar iterasi seperti di VuGen, kecuali param hasil correlation yang ditimpa ulang.
- `#include "x.c"` dan `#include "x.h"`: resolve relatif ke folder script, baca read-only.

## 7. Spesifikasi

### 7.1 Fungsi yang didukung (bertahap)

**Tahap inti (F3):**
- `web_url`, `web_custom_request`
- `lr_start_transaction`, `lr_end_transaction` (`LR_AUTO`, `LR_PASS`, `LR_FAIL`), `lr_think_time`
- `lr_save_string`, `lr_eval_string`, `lr_output_message`, `lr_error_message`
- `web_add_header`, `web_add_auto_header`

**Tahap lanjut (F5):**
- `web_submit_data` (ITEMDATA / ENDITEM), `web_submit_form` (versi sederhana)
- `web_reg_save_param`, `web_reg_save_param_ex`, `web_reg_save_param_regexp`
- `web_reg_find`
- `web_add_cookie`, `web_cleanup_cookies`, `web_set_user` (dasar)

**Tahap berikut (F6, opsional):** parameter dari `.prm`/`data/*.dat` (baris berganti per iterasi, minimal mode sequential), subset control flow C (`if/else/for/while`, `int`, `char*`, `strcmp`, `sprintf`, `atoi`, `strcpy`).

Semua fungsi di luar daftar: warning "unsupported", dilewati.

### 7.2 Aturan transpile (C → JS internal)

- Tokenizer wajib paham: string literal dan escape (`\"`, `\\`, `\n`, `\x..`), concatenation literal bersebelahan, komentar `/* */` dan `//`, makro `LAST`, `ITEMDATA`, `ENDITEM`, `EXTRARES`.
- Setiap statement hasil transpile diawali penanda lokasi, misalnya `__at("Action.c", 45);`, sehingga setiap step dan error langsung terpetakan ke **baris C** tanpa source map penuh.
- Pemanggilan `web_*` dan `lr_*` dibuat `await`.
- Substitusi `{param}` dilakukan **saat runtime** di semua argumen string fungsi `web_*`/`lr_*` (bukan saat kompilasi), karena nilai param bisa berubah (correlation).
- Param yang tidak ditemukan: biarkan teks `{param}` apa adanya dan tulis warning di log.
- Statement di luar subset yang didukung: ubah menjadi `__unsupported("<teks asli>")`.
- JS hasil transpile disimpan di cache dan dijalankan oleh `runner.js` (lewat `import()` dari `pathToFileURL`). Tidak pernah ditampilkan ke user.

### 7.3 Bentuk hasil run

Disimpan di `.cache/.../runs/<runId>/run.json`:

```json
{
  "runId": "20261012-101530-ab12",
  "status": "passed | failed | stopped",
  "startedAt": "ISO",
  "durationMs": 0,
  "options": { "iterations": 1, "continueOnError": false, "iterationDelayMs": 0, "newUserEachIteration": true, "insecureTLS": false, "thinkTime": "ignore", "timeoutMs": 60000 },
  "steps": [{
    "seq": 1, "iteration": 1, "type": "web_url", "name": "login_page",
    "file": "Action.c", "line": 12,
    "transaction": "T01_login",
    "request": { "method": "GET", "url": "", "headers": {}, "bodyPreview": "" },
    "response": { "status": 200, "statusText": "OK", "headers": {}, "contentType": "text/html; charset=utf-8", "size": 0, "bodyFile": "steps/1.body", "truncated": false },
    "timing": { "startMs": 0, "durationMs": 0 },
    "checks": [{ "type": "web_reg_find", "text": "", "passed": true }],
    "error": null
  }],
  "transactions": [{ "iteration": 1, "name": "T01_login", "status": "Pass", "durationMs": 0 }],
  "params": { "name": "value" },
  "log": [{ "ts": 0, "level": "info|warn|error", "msg": "", "file": "Action.c", "line": 12 }]
}
```

- Body response disimpan sebagai file terpisah di `steps/<seq>.body` (batas default 5 MB, tandai `truncated`).
- Decode body sesuai charset di `Content-Type`.
- Tulis bentuk ini sebagai `@typedef` JSDoc di `server/runs/store.js`.

### 7.4 API (Vite middleware)

Semua route di bawah prefix `/api`, didaftarkan lewat `server.middlewares.use('/api', handler)` di `configureServer`. Tanpa Express: query dibaca dengan `new URL(req.url, 'http://x')`, body JSON dibaca manual di `http-utils.js`.

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/health` | `{ ok: true }` |
| GET | `/api/project?path=` | Validasi folder, kembalikan daftar file, actions, run logic |
| GET | `/api/file?path=&file=` | Baca isi file (read-only) |
| PUT | `/api/file` | Simpan file `.c`/`.h` (atomic, backup ke cache) |
| POST | `/api/run` | Mulai run `{path, options}` → `{runId}` |
| GET | `/api/run/:id/events` | SSE: event `step`, `log`, `transaction`, `done` |
| POST | `/api/run/:id/stop` | Kill child process |
| GET | `/api/run/:id` | `run.json` lengkap |
| GET | `/api/run/:id/step/:seq/body` | Body response mentah |

Validasi path: harus folder yang ada, dan `file` tidak boleh keluar dari folder script (cegah `..`, path absolut, dan symlink keluar folder).

Aturan SSE: header `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`; kirim komentar heartbeat tiap ~15 detik; bersihkan listener saat `req` close.

### 7.5 UI

Layout tiga area, dibangun dengan Tailwind v4 (tanpa komponen library):
- **Kiri:** FileTree (action dan file script) + daftar step hasil run (nama, status code, durasi, ikon pass/fail). Step muncul live saat run berjalan. Ada selector iterasi (Iterasi 1..N) untuk memfilter step.
- **Tengah:** Editor `.c` (tab per file). Klik step → editor lompat ke baris dan highlight. Klik baris yang punya step → step terpilih di daftar.
- **Kanan / bawah (tab):**
  - **Snapshot:** render body HTML di `<iframe sandbox="" srcdoc>`. Default **tanpa** memuat resource eksternal (CSP meta `default-src 'none'; style-src 'unsafe-inline'; img-src data:`). Sediakan toggle "Load resources" yang menyuntik `<base href>` ke URL step dan melonggarkan CSP. Untuk response non-HTML (JSON/XML/teks) tampilkan pretty-print; biner tampilkan ukuran dan tipe.
  - **Request**, **Response** (header + body mentah), **Parameter** (nilai param saat step itu), **Log**.
- **Toolbar:** input path folder script + riwayat path terakhir (localStorage), tombol Run, Stop, opsi (jumlah iterasi, lanjut/berhenti saat error, jeda antar iterasi, user baru tiap iterasi, insecure TLS, think time `ignore|run`), indikator status.

## 8. Tahap kerja

Setiap tahap punya acceptance criteria (AC). Jangan lanjut sebelum AC terpenuhi.

### F0 — Scaffold
- [ ] Vite + vanilla JS + Tailwind v4 (`@tailwindcss/vite`), `server/vite-plugin.js` terdaftar di `vite.config.js`, satu perintah `npm run dev`.
- [ ] `server.watch.ignored` untuk `.cache/` dan folder script; cleanup child process saat server close.
- [ ] Vitest, ESLint, `.gitignore` (`.cache/`, `node_modules/`).
- **AC:** halaman kosong tampil, `GET /api/health` mengembalikan ok, `npm test` hijau.

### F1 — Loader + Editor
- [ ] Endpoint `project`, `file`, `PUT file` (atomic + backup + pertahankan CRLF).
- [ ] FileTree dan editor CodeMirror multi-tab, Save.
- **AC:** buka folder sampel, edit `Action.c`, Save; `git diff`/hash menunjukkan **hanya** file itu yang berubah; line ending tidak berubah; Save tidak memicu reload halaman.

### F2 — Tokenizer + Parser
- [ ] Tokenizer dan parser pemanggilan fungsi C (argumen string, angka, makro, nested call).
- [ ] Golden test: minimal 10 kasus (escape, concatenation, komentar, `ITEMDATA`/`ENDITEM`, argumen multi-baris).
- **AC:** parse seluruh `Action.c` sampel tanpa error; setiap call punya `file` dan `line` yang benar.

### F3 — Transpile + Runtime inti
- [ ] Transpiler untuk fungsi inti (7.1), penanda `__at`.
- [ ] Runner child process: cookie jar, redirect manual (catat tiap hop), timeout, opsi insecure TLS, think time `ignore` default.
- [ ] Loop iterasi sesuai Run Logic (init sekali, Action × N, end sekali) dengan opsi `continueOnError`, `iterationDelayMs`, `newUserEachIteration`.
- [ ] Penyimpanan hasil run (7.3) + body file.
- **AC:** run CLI (tanpa UI) pada sampel menghasilkan `run.json` dengan step, status, header, body, transaksi, dan nomor baris yang benar; fungsi unsupported tercatat sebagai warning. Dengan iterasi = 3, `vuser_init` dan `vuser_end` berjalan sekali, Action tiga kali, dan setiap step punya field `iteration` 1..3.

### F4 — UI Run + Snapshot
- [ ] Route `run`, `events` (SSE), `stop`, `step body`.
- [ ] Run/Stop, SSE live, daftar step, SnapshotPanel, Request/Response/Parameter/Log.
- [ ] Sinkron klik step ↔ baris editor.
- [ ] Kontrol jumlah iterasi di toolbar dan selector iterasi di daftar step.
- **AC:** klik Run pada sampel → step muncul live, klik step menampilkan snapshot HTML-nya; Stop menghentikan proses di bawah 2 detik dan tidak meninggalkan proses yatim; error runtime menunjuk baris C yang benar; restart Vite tidak meninggalkan child process.

### F5 — Fungsi lanjutan
- [ ] `web_submit_data`, `web_submit_form`, correlation (`web_reg_save_param*`), `web_reg_find`, cookie.
- **AC:** flow login 3 langkah dengan correlation (token dari step 1 dipakai step 2) berjalan benar; tab Parameter menampilkan nilai hasil correlation.

### F6 — Parameter file dan control flow (opsional)
- [ ] Parameter dari `.prm`/`data/*.dat` dan subset C (7.1).
- **AC:** script sampel dengan loop dan if berjalan sesuai ekspektasi.

## 9. Sampel uji (taruh di `samples/basic/Action.c`)

```c
Action()
{
    lr_start_transaction("T01_home");

    web_reg_save_param("csrf",
        "LB=name=\"csrf\" value=\"",
        "RB=\"",
        "Ord=1",
        LAST);

    web_url("home",
        "URL=https://example.test/",
        "TargetFrame=",
        "Resource=0",
        "RecContentType=text/html",
        "Referer=",
        "Mode=HTML",
        LAST);

    lr_end_transaction("T01_home", LR_AUTO);

    lr_think_time(2);

    web_submit_data("login",
        "Action=https://example.test/login",
        "Method=POST",
        "Mode=HTML",
        ITEMDATA,
        "Name=user", "Value=demo", ENDITEM,
        "Name=csrf", "Value={csrf}", ENDITEM,
        LAST);

    return 0;
}
```

Untuk tes tanpa server nyata, buat mock server kecil (`node:http`) di `server/test/mock.js` yang melayani `/` dan `/login`.

## 10. Tahap lanjutan (jangan dikerjakan sekarang)

- **Step Toolbox:** panel daftar fungsi VuGen + contoh pemakaian + insert snippet di kursor + autocomplete. Data dalam satu `toolbox.json` (id, kategori, signature, deskripsi, atribut, snippet, contoh, `supportedInRun`).
- Ringkasan transaksi per iterasi (min/avg/max) dan export hasil run.

## 11. Risiko dan catatan

- Parser C adalah titik paling rawan. Prioritaskan toleransi: bila gagal parse satu statement, tandai unsupported dan lanjut.
- Tanpa TypeScript, kontrak data (AST, `run.json`, event SSE) mudah melenceng. Jaga dengan JSDoc `@typedef` dan golden test.
- Middleware Vite hanya hidup selama dev server jalan. Perubahan `vite.config.js` me-restart server; pastikan child process ikut dibersihkan (aturan 8).
- Perilaku HTTP runtime Node bisa sedikit berbeda dari VuGen (urutan header, kompresi, HTTP/2, TLS). Catat sebagai known limitation, jangan dikejar kesamaannya di tahap ini.
- Snapshot dirender di iframe sandbox tanpa script; ini disengaja agar HTML dari server target tidak bisa mengeksekusi apa pun di aplikasi.
- Data run bisa berisi kredensial dan token. Folder `.cache/` harus di-`.gitignore` dan jangan dikirim ke luar mesin.