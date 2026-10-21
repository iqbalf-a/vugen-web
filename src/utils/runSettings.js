/**
 * src/utils/runSettings.js — Ringkasan pengaturan run untuk label tombol "Run settings".
 */

/**
 * @param {{ iterations: number, delayMs: number, newUser: boolean, continueOnError: boolean, insecureTLS: boolean, thinkTime: string }} settings
 * @returns {Array<{ text: string, warn?: boolean }>}
 */
export function summarizeRunSettings(settings) {
  const iterations = Math.max(1, Number(settings.iterations) || 1);
  const delayMs = Math.max(0, Number(settings.delayMs) || 0);
  const parts = [{ text: `${iterations} ${iterations === 1 ? "iteration" : "iterations"}` }];
  if (iterations > 1 && delayMs > 0) parts.push({ text: `${delayMs} ms delay` });
  if (settings.newUser) parts.push({ text: "new user" });
  if (settings.continueOnError) parts.push({ text: "continue on error" });
  if (settings.thinkTime === "run") parts.push({ text: "think time" });
  if (settings.insecureTLS) parts.push({ text: "insecure TLS", warn: true });
  return parts;
}
