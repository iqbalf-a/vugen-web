import { getHealth } from "./api.js";
import { createStore } from "./store.js";

const store = createStore({
  /** @type {"checking" | "ok" | "warn" | "error"} */
  health: "checking",
  message: "Memeriksa API…",
});

const statusEl = document.querySelector("#status");

store.subscribe((state) => {
  if (!statusEl) return;
  statusEl.textContent = state.message;
  statusEl.dataset.state = state.health;
});

async function checkHealth() {
  try {
    const { ok } = await getHealth();
    store.set(
      ok
        ? { health: "ok", message: "API siap" }
        : { health: "warn", message: "API merespons tidak dikenal" },
    );
  } catch (error) {
    store.set({
      health: "error",
      message: `API tidak siap: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

checkHealth();
