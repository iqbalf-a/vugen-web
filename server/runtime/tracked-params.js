/**
 * runtime/tracked-params.js — Map parameter VuGen yang mencatat setiap perubahan.
 *
 * Setiap `set`/`delete` dicatat (nama, nilai, sumber, file:baris tempat dipanggil). Runtime memanggil
 * `drain()` saat mengirim event `step` sehingga step membawa perubahan sejak step sebelumnya; UI
 * menyusun nilai parameter pada step tertentu dengan menerapkan perubahan itu berurutan.
 * Nama yang sama dua kali di antara dua step hanya dicatat nilai terakhirnya.
 *
 * @typedef {Object} ParamChange
 * @property {string} name
 * @property {string} [value] - tidak ada bila `removed`
 * @property {boolean} [removed]
 * @property {string} source - mis. "lr_save_string", "web_reg_save_param (regexp)", ".dat: ip.dat"
 * @property {string} [file]
 * @property {number} [line]
 */

export class TrackedParams extends Map {
  /** @param {() => { file?: string, line?: number }} [where] posisi script saat ini */
  constructor(where) {
    super();
    this.where = where ?? (() => ({}));
    /** @type {Map<string, ParamChange>} */
    this.pending = new Map();
  }

  /**
   * @param {string} name
   * @param {string} value
   * @param {string} [source] asal perubahan (untuk tooltip di UI)
   */
  set(name, value, source = "script") {
    super.set(name, value);
    // Map constructor tidak memanggil set tanpa iterable, tapi jaga-jaga bila pending belum ada
    this.pending?.set(name, { name, value, source, ...this.where() });
    return this;
  }

  delete(name) {
    const existed = super.delete(name);
    if (existed) this.pending.set(name, { name, removed: true, source: "dihapus", ...this.where() });
    return existed;
  }

  /** Ambil dan kosongkan perubahan sejak panggilan terakhir. @returns {ParamChange[]} */
  drain() {
    const changes = [...this.pending.values()];
    this.pending.clear();
    return changes;
  }
}
