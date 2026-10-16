# Tugas Sonnet — U1: Rapikan UI/UX (proporsi, spasi, search panel)

> Cara pakai: di sesi Sonnet cukup tulis **"Baca dan kerjakan prompt-sonnet.md"**.
> Prompt tahap S1–S7 lama sudah selesai dan ada di riwayat git (`git log -- prompt-sonnet.md`).

Hasil audit UI dengan Chrome headless di **1500×900** dan **1280×720**. Skenario sintetis: 2 iterasi, 2 transaksi (salah satunya bernama panjang), 4 step (JSON, HTML, dan satu step 500), `web_reg_save_param_json`, serta panel Search Ctrl+F/Ctrl+H. Console browser bersih, tidak ada horizontal scroll di level halaman. Masalahnya ada di **proporsi, spasi, konsistensi, dan panel search**.

---

## 0. Aturan

1. **Cek dulu `git status`.** Saat audit ada perubahan UI/runtime yang belum di-commit, antara lain `parameterPanel.js`, `snapshotPanel.js`, `stepList.js`, `steps.js`, `tracked-params.js`, `referenced-params.js`, `callRange.js`, dan `params.js`. Perubahan itu berasal dari sesi lain, plus perubahan kecil `stepList.js` dari Opus.
   - Bila perubahan itu masih ada dan **bukan** buatanmu: BERHENTI, lalu tanya user apakah perlu di-commit dulu.
   - Jangan menimpa atau membuangnya.
2. Ini perbaikan **tampilan**:
   - Tidak boleh ada endpoint, dependency, atau fitur baru seperti splitter yang bisa di-drag, tema terang, atau panel baru.
   - Perilaku fungsional tidak berubah, kecuali butir bertanda **[bug]**.
3. Hasil keamanan S1 wajib tetap:
   - Semua nilai di `innerHTML` lewat `escapeHtml` (`src/utils/html.js`).
   - Snapshot HTML tetap di `<iframe sandbox="">` lewat DOM API.
4. Pakai token warna yang sudah ada:
   - Latar `#0f141a` / `#141922` / `#1b212b`, garis `#232a33` / `#2a3644`.
   - Teks `#e6edf3` / `#aab4c0` / `#7d8896` / `#5b6572`, aksen `#d2a24c`.
   - Hindari campuran `gray-*` Tailwind dan hex untuk peran yang sama. Ganti `gray-*` di komponen yang kamu sentuh ke token hex di atas.
5. **Skala spasi: 4 / 8 / 12 / 16 px** (`1 / 2 / 3 / 4` di Tailwind). **Skala teks:**
   - 10px: label/eyebrow uppercase
   - 11px: meta/angka (mono)
   - 12.5px: item list dan isi panel
   - 13–14px: judul panel
6. Folder `D:\Mandiri\...` read-only. Jangan kirim request ke server target asli. Uji pakai mock lokal.
7. Sebelum commit:
   - `npx vitest run`, `npx eslint .`, dan `node server/test/run-cli.js samples/f5 1` harus lulus.
   - Ambil screenshot sebelum/sesudah di **1280×720** dan **1500×900**. Cara di §3.
8. Commit per kelompok:
   - `U1a: layout & proporsi`
   - `U1b: step list`
   - `U1c: snapshot/parameter/log`
   - `U1d: search panel`
   - `U1e: bug kecil`
   - Setiap commit juga update `todo.md`.
9. Selesai:
   - Laporkan tiap butir (✅/❌ + screenshot path) dan hal yang butuh keputusan user.
   - Lalu BERHENTI.

---

## 1. Temuan & perbaikan

### U1a — Layout global & proporsi (`index.html`, `src/main.js`)

- [x] **Kolom tidak proporsional.** Grid sekarang `260px | 1fr | 380px`.
  - Panel kanan terlalu sempit: judul snapshot terpotong (`Snapshot #1 POST /api...`), dan subjudul juga terpotong.
  - Editor mengambil hampir semua lebar, padahal baris script jarang sepanjang itu.
  - Usulan: `grid-cols-[minmax(240px,18%)_minmax(0,1fr)_minmax(400px,34%)]` (sesuaikan bila perlu). Target di 1280 lebar: kiri ±240, kanan ±435. Di 1500: kiri ±270, kanan ±510.
- [x] **Kolom kiri dibagi 50/50** antara File Script dan Step Run. Setelah run, Step Run adalah konten utama, tapi di 720px tinggi hanya muat ±5 baris.
  - Usulan: File Script `max-h-[38%]` dengan scroll sendiri, Step Run `flex-1`.
  - Header seksi ("FILE SCRIPT", "STEP RUN") seragam: tinggi 32px, padding `px-3`, border bawah satu garis.
- [x] **Heading kategori file tree pecah dua baris** ("ACTION / UTAMA", "PARAMETER / FILES", "CONFIG & / OTHERS") dengan garis pemisah di samping.
  - Buat `whitespace-nowrap`, garis `flex-1`, jarak heading ke item 4px, dan antar kategori 12px.
  - Teks kosong "Belum ada folder yang dibuka." masih font sans. Samakan dengan teks kosong lain (12px, `#5b6572`).
- [x] **Bar opsi run boros dan jaraknya tidak rata.** Grid `grid-cols-6` menyebar 6 kontrol ke seluruh lebar dengan celah besar tak seragam, dan "▲ Sembunyikan opsi" ada di baris terpisah. Header + opsi memakan ±150px dari 720.
  - Jadikan satu baris `flex flex-wrap items-center gap-x-5 gap-y-2`, rata kiri.
  - Tiap kontrol berupa pasangan label + input dengan jarak 8px. Label 10px uppercase `#7d8896`, rata tengah vertikal dengan input setinggi 24px.
  - Tombol Sembunyikan/Tampilkan opsi taruh di ujung kanan baris yang sama (`ml-auto`).
  - Target tinggi bar opsi ≤ 40px.
- [x] **Status run** ("Run selesai: failed") berupa teks mono 11px di pojok kanan dan mudah terlewat.
  - Jadikan badge: titik warna + teks, latar `#1b212b`, border mengikuti status (hijau passed, merah failed, kuning running/stopped).
  - Tidak ada teks status baru. Pakai teks yang sudah ada.
- [x] **Scrollbar corner putih.** Kotak putih terlihat di pojok kanan bawah editor dan panel kanan di 1280×720.
  - Tambahkan `::-webkit-scrollbar-corner { background: transparent }` dan `scrollbar-color` untuk Firefox di `src/style.css`.
  - Pastikan scrollbar CodeMirror (`.cm-scroller`) ikut tema gelap.

### U1b — Step list (`src/components/stepList.js`)

- [x] **Nama transaksi terpotong parah** (`login_t…`) karena "2 API", "1/2 OK", dan durasi memakan tempat. Nama transaksi harus diprioritaskan:
  - Baris header: `▼ nama-transaksi` (nama `min-w-0 truncate`, `flex-1`), lalu di kanan **hanya** `1/2 OK` dan durasi.
  - Hapus "2 API" karena sudah tersirat di `1/2`.
  - Toggle ▼/▶ taruh **di kiri** nama, ukuran tetap 12px, supaya kolom rata.
  - Angka pakai `tabular-nums`. Durasi rata kanan dengan lebar tetap (mis. `w-14 text-right`) supaya sejajar antar baris.
- [x] **Format durasi tidak seragam** ("4.6ms", "58ms", "6.7ms" bercampur).
  - Tetap pakai `formatMs` di `src/utils/steps.js`, tapi sejajarkan dengan kolom rata kanan seperti di atas.
- [x] **Label step `POST /api/public/c…` terpotong di bagian paling informatif.** Ujung path biasanya pembeda antar API.
  - Tampilkan method sebagai badge kecil berlebar tetap (GET/POST, 10px).
  - Path dipotong **dari depan** (`…/content/inquiry`). Cukup potong di JS menjadi 2 segmen terakhir bila lebih dari 28 karakter, dan path lengkap tetap di `title`.
  - Nomor `#1` 10px `#5b6572`.
- [x] **Spasi baris tidak konsisten.**
  - Header transaksi `py-1.5`, item step `py-1`, indentasi step 20px dari tepi kiri nama transaksi, dan jarak antar transaksi 8px.
  - Baris error ("HTTP 500") sejajar dengan teks label step (indent sama), 11px.
  - Item terpilih: latar `#1b212b` plus border kiri 2px aksen `#d2a24c`. Hover: latar `#161c24`.
- [x] **Selector iterasi** memakai label "Iterasi" + select "Iterasi 1 ✗". Kata "Iterasi" muncul dua kali, padding `p-3` besar, dan select tinggi.
  - Jadikan satu baris: label kecil + select setinggi 28px. Teks opsi tetap dari `groupLabel` (vuser_init / Iterasi N / vuser_end) beserta tanda ✗.
  - Jarak ke list 8px.

### U1c — Snapshot, Parameter, Log (`snapshotPanel.js`, `parameterPanel.js`, `logPanel.js`, `main.js`)

- [ ] **Dua gaya tab berbeda.** Tab panel (Snapshot/Parameter/Log) dan tab snapshot (Request/Response/Raw) memakai gaya yang tidak sama, ditambah sub-tab Parameter ("Parameter VuGen / Variabel C") yang berbentuk kartu.
  - Seragamkan ketiganya: teks 12px, `px-3 h-8`, aktif = teks `#e6edf3` + garis bawah 2px `#d2a24c`, nonaktif = `#7d8896`.
  - Hitungan (2, 0) jadi badge kecil inline di kanan label, bukan di baris kedua.
- [ ] **Header snapshot terlalu padat.** Judul, status, tipe, dan ukuran ada dalam satu baris sehingga judul terpotong.
  - Baris 1: `#1` + badge method + path (truncate, `title` lengkap).
  - Baris 2 (11px, `#7d8896`): nama step · Snapshot=tN.inf · Iterasi · file:baris.
  - Status/tipe/ukuran **cukup sekali**. Sekarang tampil dua kali, di header dan di kartu "RESPONSE". Pertahankan di kartu RESPONSE saja.
- [ ] **[bug] "200 -" / "500 -" / "HTTP/1.1 200 -":** tanda `-` muncul karena `statusText` kosong (umum di HTTP/1.1 modern). Tampilkan hanya kode bila `statusText` kosong, baik di header, kartu, maupun tab Raw.
- [ ] **Jarak antar seksi panel kanan** (RESPONSE / HEADERS / BODY) tidak seragam.
  - Seksi `space-y-4`, judul seksi ke isinya 6px.
  - Tombol Copy sejajar vertikal dengan judul seksi dan berukuran sama di semua seksi.
- [ ] **URL di tab Request terputus di tengah kata** ("inqui / ry"). Pakai `overflow-wrap:anywhere` (bukan `break-all`) supaya pemutusan terjadi di `/` bila memungkinkan.
- [ ] **Log sulit dibaca.** `break-all` memotong kata di tengah ("load / page", "r / egistered"), kolom timestamp dan file memakan lebar, dan tiap baris punya border sendiri.
  - Pakai `overflow-wrap:anywhere`.
  - Layout grid `[auto_auto_1fr]`: waktu (11px `#5b6572`), lokasi file:baris (11px `#7d8896`), pesan (12px).
  - Ikon level menempel di pesan. Hapus border per baris, ganti hover `#161c24` dan `py-0.5`.
  - Baris warn: teks kuning. Baris error: merah. Info: default.
- [ ] **Header panel Log** ("Log" + Auto-scroll) dan Parameter ("pada Snapshot #4 · Action.c…") tingginya beda. Samakan tinggi toolbar panel 36px, `px-3`, dan teks konteks 11px truncate.

### U1d — Panel search CodeMirror (`src/components/editor.js`, `src/style.css`)

Temuan:
- Panel search/replace (Ctrl+F / Ctrl+H) tampil dengan gaya bawaan CodeMirror: input kecil berborder putih, tombol abu-abu terang berlabel bahasa Inggris huruf kecil ("next", "previous", "all", "replace", "replace all").
- Checkbox tidak sejajar dengan labelnya ("match case", "regexp", "by word").
- Tombol tutup "×" melayang jauh di pojok kanan atas.
- Panel menempel tanpa padding dan baris replace tidak sejajar dengan baris search.

Perbaikan lewat `EditorView.theme` (sudah ada `THEME` di `editor.js`) dan/atau CSS, **tanpa dependency baru**:
- [ ] `.cm-panels-bottom`: latar `#141922`, border atas `#232a33`.
  - `.cm-search`: `display:flex; flex-wrap:wrap; align-items:center; gap:6px 8px; padding:8px 12px; font-size:12px`.
  - `<br>` bawaan disembunyikan, diganti `flex-basis:100%`, supaya baris replace rata kiri sejajar baris search.
- [ ] `.cm-textfield`: tinggi 26px, lebar 220px, latar `#0f141a`, border `#2a3644`, radius 3px, teks `#e6edf3`, focus border `#d2a24c` tanpa outline putih.
- [ ] `.cm-button`: tinggi 26px, `padding:0 10px`, latar `#1b212b`, border `#2a3644`, teks `#e6edf3`, radius 3px, tanpa gradient bawaan (`background-image:none`), hover border `#3a4553`.
- [ ] Label checkbox: `display:inline-flex; align-items:center; gap:4px; color:#aab4c0`, checkbox `accent-color:#d2a24c`.
- [ ] Tombol close (`button[name=close]`): sejajar di baris pertama paling kanan (`margin-left:auto`, bukan absolute), ukuran 20×20, warna `#7d8896`, hover `#e6edf3`.
- [ ] Label bahasa Indonesia via `EditorState.phrases.of({...})`:
  - "Find" → "Cari", "Replace" → "Ganti", "next" → "Berikutnya", "previous" → "Sebelumnya", "all" → "Semua"
  - "match case" → "Huruf besar/kecil", "regexp" → "Regex", "by word" → "Kata utuh"
  - "replace" → "Ganti", "replace all" → "Ganti semua", "close" → "Tutup"
  - Cek kunci frasa yang benar di `@codemirror/search`. Jangan menebak.
- [ ] Highlight hasil: `.cm-searchMatch` latar `rgba(210,162,76,.25)` + outline `rgba(210,162,76,.5)`, `.cm-searchMatch-selected` latar `rgba(210,162,76,.5)`. Harus terlihat jelas di tema one-dark, dan beda dari highlight seleksi biasa.
- [ ] Verifikasi di 1280×720: panel search tidak menutupi baris yang sedang aktif, tidak ada horizontal scroll, dan Esc menutup panel.

### U1e — Bug kecil yang terlihat saat audit

- [ ] **[bug] Klik step pertama tepat setelah run selesai kadang membuat panel Snapshot kosong.** Terjadi 1 dari 2 percobaan, di 1500×900: tab Request/Raw ikut kosong, lalu klik step lain bekerja.
  - Dugaan: race antara render snapshot (async fetch body) dan penggantian `currentRun` oleh `run.json` setelah event `done`.
  - Pastikan render snapshot memakai token/versi request terakhir dan dirender ulang saat `currentRun` diganti tetapi `selectedStep.seq` sama.
- [ ] **[bug] Log warn palsu `Parameter "{"a":1}" not found, leaving as-is`** untuk body JSON `Body={"a":1}`.
  - Substitusi `{...}` di runtime hanya boleh untuk nama parameter yang valid (`[A-Za-z_][A-Za-z0-9_]*`, cek aturan nama param VuGen di contoh script read-only bila ragu).
  - Kurung kurawal JSON tidak boleh memicu warning.
  - Tambah unit test.
- [ ] Teks kosong panel Snapshot saat belum ada step terpilih: tampilkan petunjuk singkat "Pilih step di kiri untuk melihat snapshot" (12px, `#5b6572`, rata tengah).
  - Ini bukan fitur baru. Saat ini panel kosong total.

---

## 2. AC

- Di **1280×720** dan **1500×900**:
  - tidak ada horizontal scroll halaman;
  - nama transaksi ≤ 24 karakter tampil utuh di step list (1500);
  - judul snapshot tidak terpotong untuk path ≤ 40 karakter (1500);
  - tidak ada kotak scrollbar putih.
- Bar opsi run ≤ 40px tinggi. Step Run mendapat ≥ 60% tinggi kolom kiri setelah run.
- Panel search: semua kontrol satu gaya dengan aplikasi, label Indonesia, close sejajar, highlight hasil jelas.
- Tidak ada tanda `-` setelah kode status. Tidak ada warning param palsu untuk body JSON.
- Klik step pertama segera setelah run selalu menampilkan snapshot (ulangi 5×).
- `npx vitest run`, `npx eslint .`, dan `run-cli samples/f5 1` lulus. Console browser bersih.

## 3. Cara verifikasi visual

Pakai Chrome headless via CDP (Node 22 punya `WebSocket` global; Chrome ada di `C:/Program Files/Google/Chrome/Application/chrome.exe`). Tidak perlu dependency baru.

Contoh harness siap pakai dari audit ini (boleh disalin ke folder temp, **jangan di-commit**):
- `C:\Users\ADIDAT~1.ARD\AppData\Local\Temp\claude\C--Users-adidata-ardiansyah-Documents-github-repos-vugen-web\a644d5fe-5077-4f48-bf94-fe8d1b94a162\scratchpad\audit.mjs`
  - Argumen: `<appUrl> <scriptDir> <outDir> <width> <height> <prefix>`.
  - Alurnya: buka folder, 2 iterasi, Run, klik step, tab Request/Raw, step HTML, step gagal, Parameter, Log, Ctrl+F, Ctrl+H.
- Script + mock sintetis: folder `...\scratchpad\fakeweb\` (`Action.c`, `ip.dat`, `mock.mjs` di port 18099).

Bila path di atas sudah tidak ada, buat ulang yang setara (mock lokal + script sintetis 2 transaksi / 4 step, termasuk satu HTML dan satu 500).

Jalankan `npx vite --port 5179 --strictPort` dan `node fakeweb/mock.mjs`, lalu harness di 1280 720 dan 1500 900. Lampirkan path screenshot sebelum/sesudah di laporan.
