/**
 * src/components/runSettings.js — Popover "Run settings" di toolbar.
 *
 * Input aslinya (#iterations, #continueOnError, dst.) tetap dibaca main.js lewat id yang sama;
 * komponen ini hanya mengatur buka/tutup, ringkasan pada tombol, dan penguncian saat run berjalan.
 */

import { escapeHtml } from "../utils/html.js";
import { summarizeRunSettings } from "../utils/runSettings.js";

/**
 * @param {{
 *   button: HTMLElement, panel: HTMLElement, summary: HTMLElement, lockNote: HTMLElement,
 *   fields: { iterations: HTMLInputElement, delay: HTMLInputElement, newUser: HTMLInputElement,
 *     continueOnError: HTMLInputElement, insecureTLS: HTMLInputElement, thinkTime: HTMLSelectElement }
 * }} refs
 */
export function createRunSettings({ button, panel, summary, lockNote, fields }) {
  const inputs = Object.values(fields);
  let locked = false;

  function refreshSummary() {
    const parts = summarizeRunSettings({
      iterations: fields.iterations.value,
      delayMs: fields.delay.value,
      newUser: fields.newUser.checked,
      continueOnError: fields.continueOnError.checked,
      insecureTLS: fields.insecureTLS.checked,
      thinkTime: fields.thinkTime.value,
    });
    summary.innerHTML = parts
      .map(part => `<span class="${part.warn ? "text-[#e3c664]" : ""}">${escapeHtml(part.text)}</span>`)
      .join('<span class="text-[#3a4553]"> · </span>');
    button.title = parts.map(part => part.text).join(" · ");
  }

  function isOpen() {
    return !panel.hidden;
  }

  function setOpen(open) {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  }

  button.addEventListener("click", () => {
    setOpen(!isOpen());
    if (isOpen()) (locked ? panel : fields.iterations).focus();
  });

  document.addEventListener("pointerdown", event => {
    if (isOpen() && !panel.contains(event.target) && !button.contains(event.target)) setOpen(false);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && isOpen()) {
      setOpen(false);
      button.focus();
    }
  });

  for (const input of inputs) {
    input.addEventListener("input", refreshSummary);
    input.addEventListener("change", refreshSummary);
  }

  refreshSummary();

  return {
    setLocked(value) {
      if (value === locked) return;
      locked = value;
      for (const input of inputs) input.disabled = value;
      lockNote.hidden = !value;
    },
  };
}
