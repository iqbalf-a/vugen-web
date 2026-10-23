/**
 * src/components/profilePicker.js — Layar pilih profile (gerbang masuk).
 *
 * Tampil full-screen sebelum app dimuat. Memblokir sampai session aktif.
 * Admin: ketik "admin" di input khusus → masuk sebagai admin → bisa kelola profile.
 */

import { addProfile, fetchProfileList, login, logout, removeProfile } from "../api.js";

/** @type {HTMLElement|null} */
let overlay = null;
/** @type {(() => void)|null} */
let resolveLogin = null;

function closeOverlay() {
  if (overlay) overlay.hidden = true;
}

async function doLogin(profile) {
  await login(profile);
  closeOverlay();
  resolveLogin?.(profile);
}

function renderAdminPanel(container) {
  container.innerHTML = `
    <div class="mb-4 flex items-center justify-between">
      <span class="font-mono text-[11px] uppercase tracking-[0.08em] text-[#d2a24c]">Admin — Manage Profiles</span>
    </div>
    <div id="adminProfileList" class="mb-4 space-y-1.5"></div>
    <div class="flex gap-2">
      <input id="newProfileInput" type="text" placeholder="new profile name"
        class="h-8 flex-1 rounded-[3px] border border-[#2a3644] bg-[#1b212b] px-2.5 font-mono text-[12px] text-[#e6edf3] outline-none placeholder:text-[#5b6572] focus:border-[#d2a24c]" />
      <button id="addProfileBtn"
        class="h-8 rounded-[3px] border border-[#d2a24c] bg-[#d2a24c] px-3 text-[12px] font-bold text-[#1c1200] hover:bg-[#e0b05a]">
        Add
      </button>
    </div>
    <p id="adminError" class="mt-2 hidden text-[11px] text-red-400"></p>
  `;

  const listEl = container.querySelector("#adminProfileList");
  const input = container.querySelector("#newProfileInput");
  const addBtn = container.querySelector("#addProfileBtn");
  const errEl = container.querySelector("#adminError");

  async function refresh() {
    const { profiles } = await fetchProfileList();
    listEl.innerHTML = profiles.map((p) => `
      <div class="flex items-center justify-between rounded-[3px] border border-[#2a3644] px-3 py-1.5">
        <span class="font-mono text-[12px] text-[#e6edf3]">${p}</span>
        <button data-del="${p}"
          class="text-[11px] text-[#7d8896] hover:text-red-400">Delete</button>
      </div>
    `).join("");

    listEl.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await removeProfile(btn.dataset.del);
          await refresh();
        } catch (e) {
          errEl.textContent = e.message;
          errEl.classList.remove("hidden");
        }
      });
    });
  }

  refresh();

  addBtn.addEventListener("click", async () => {
    const name = input.value.trim();
    errEl.classList.add("hidden");
    try {
      await addProfile(name);
      input.value = "";
      await refresh();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove("hidden");
    }
  });

  input.addEventListener("keydown", (e) => { if (e.key === "Enter") addBtn.click(); });
}

async function renderPicker(isAdmin = false) {
  const { profiles } = await fetchProfileList();

  overlay.innerHTML = `
    <div class="flex h-full flex-col items-center justify-center px-4">
      <div class="w-full max-w-[480px]">
        <!-- Header -->
        <div class="mb-8 text-center">
          <div class="text-[22px] font-bold tracking-tight">VuGen Web</div>
          <div class="mt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-[#7d8896]">
            ${isAdmin ? "Admin — Manage Profiles" : "Select Profile"}
          </div>
        </div>

        ${isAdmin ? `
          <div id="adminArea"></div>
          <div class="mt-6 border-t border-[#232a33] pt-4 text-center">
            <button id="backToPickerBtn" class="font-mono text-[11px] text-[#7d8896] hover:text-[#e6edf3]">
              Continue as regular user
            </button>
          </div>
        ` : `
          <!-- Grid profile -->
          <div class="mb-8 grid grid-cols-3 gap-3">
            ${profiles.map((p) => `
              <button data-profile="${p}"
                class="profile-card group flex flex-col items-center gap-2 rounded-[6px] border border-[#2a3644] bg-[#1b212b] px-4 py-4 hover:border-[#d2a24c] hover:bg-[#1e2530]">
                <div class="flex h-10 w-10 items-center justify-center rounded-full bg-[#232a33] text-[15px] font-bold uppercase text-[#d2a24c] group-hover:bg-[#2a3420]">
                  ${p.slice(0, 2).toUpperCase()}
                </div>
                <span class="font-mono text-[12px] text-[#c9d1d9] group-hover:text-[#e6edf3]">${p}</span>
              </button>
            `).join("")}
          </div>

          <!-- Admin input -->
          <div class="border-t border-[#232a33] pt-4">
            <label class="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.08em] text-[#5b6572]">Admin access</label>
            <div class="flex gap-2">
              <input id="adminInput" type="text" placeholder="type admin then Enter"
                class="h-8 flex-1 rounded-[3px] border border-[#232a33] bg-[#1b212b] px-2.5 font-mono text-[12px] text-[#e6edf3] outline-none placeholder:text-[#3d4553] focus:border-[#d2a24c]" />
              <button id="adminEnterBtn"
                class="h-8 rounded-[3px] border border-[#232a33] bg-[#1b212b] px-3 text-[12px] font-medium text-[#7d8896] hover:border-[#3a4553] hover:text-[#e6edf3]">
                Sign In
              </button>
            </div>
            <p id="adminErr" class="mt-1.5 hidden text-[11px] text-red-400"></p>
          </div>
        `}
      </div>
    </div>
  `;

  if (isAdmin) {
    renderAdminPanel(overlay.querySelector("#adminArea"));
    overlay.querySelector("#backToPickerBtn").addEventListener("click", () => renderPicker(false));
    // Admin juga bisa masuk sebagai user: klik salah satu profile card
    return;
  }

  // Profile cards
  overlay.querySelectorAll(".profile-card").forEach((btn) => {
    btn.addEventListener("click", () => doLogin(btn.dataset.profile));
  });

  // Admin input
  const adminInput = overlay.querySelector("#adminInput");
  const adminBtn = overlay.querySelector("#adminEnterBtn");
  const adminErr = overlay.querySelector("#adminErr");

  const tryAdmin = async () => {
    const val = adminInput.value.trim().toLowerCase();
    adminErr.classList.add("hidden");
    if (val !== "admin") {
      adminErr.textContent = "Only 'admin' is allowed here";
      adminErr.classList.remove("hidden");
      return;
    }
    try {
      await login("admin");
      renderPicker(true);
    } catch (e) {
      adminErr.textContent = e.message;
      adminErr.classList.remove("hidden");
    }
  };

  adminBtn.addEventListener("click", tryAdmin);
  adminInput.addEventListener("keydown", (e) => { if (e.key === "Enter") tryAdmin(); });
}

/**
 * Tampilkan profile picker dan tunggu sampai user memilih.
 * Resolve saat session berhasil di-set.
 */
export function showProfilePicker() {
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "profilePickerOverlay";
    overlay.className = "fixed inset-0 z-[300] bg-[#0e1116] overflow-y-auto";
    document.body.appendChild(overlay);
  }
  overlay.hidden = false;

  return new Promise((resolve) => {
    resolveLogin = resolve;
    renderPicker(false);
  });
}

