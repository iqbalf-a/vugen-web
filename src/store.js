/**
 * Store minimal: state + subscribe, tanpa framework (plan §3).
 *
 * @template T
 * @param {T} initial
 */
export function createStore(initial) {
  /** @type {T} */
  let state = initial;
  /** @type {Set<(state: T) => void>} */
  const listeners = new Set();

  function emit() {
    for (const listener of [...listeners]) listener(state);
  }

  return {
    /** @returns {T} */
    get: () => state,

    /**
     * @param {Partial<T> | ((prev: T) => Partial<T>)} patch
     */
    set(patch) {
      const next = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...next };
      emit();
    },

    /**
     * Listener langsung dipanggil sekali dengan state saat ini.
     *
     * @param {(state: T) => void} listener
     * @returns {() => void} fungsi unsubscribe
     */
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
  };
}

/** Singleton store instance untuk akses global dari komponen */
let _store = null;

/** Inisialisasi store singleton (dipanggil sekali di main.js) */
export function initStore(initial) {
  _store = createStore(initial);
  return _store;
}

/** Akses store singleton */
export function getStore() {
  if (!_store) throw new Error("Store belum diinisialisasi. Panggil initStore() dulu.");
  return _store;
}

/** Helper untuk getState dari store singleton */
export function getState() {
  return getStore().get();
}

/** Helper untuk subscribe ke store singleton */
export function subscribe(listener) {
  return getStore().subscribe(listener);
}


