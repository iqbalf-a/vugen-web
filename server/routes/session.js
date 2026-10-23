/**
 * server/routes/session.js — Session (pilih profile) + manajemen profile (admin only).
 *
 * Routes:
 *   GET    /api/session           — profile aktif atau null (tidak butuh auth)
 *   POST   /api/session           — login sebagai profile (tidak butuh auth)
 *   DELETE /api/session           — logout
 *   GET    /api/profiles          — daftar profile (tidak butuh auth)
 *   POST   /api/profiles          — tambah profile (admin only)
 *   DELETE /api/profiles/:name    — hapus profile (admin only)
 */

import { readJsonBody, sendError, sendJson } from "../http-utils.js";
import { listProfiles, profileExists, saveProfiles, validateProfileName } from "../profiles/store.js";

/** Baca nama profile dari cookie `vugen-profile`. */
export function getProfileFromCookie(req) {
  const raw = req.headers.cookie ?? "";
  const match = raw.match(/(?:^|;\s*)vugen-profile=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(res, profile) {
  res.setHeader("Set-Cookie", `vugen-profile=${encodeURIComponent(profile)}; Path=/; HttpOnly; SameSite=Strict`);
}

function clearCookie(res) {
  res.setHeader("Set-Cookie", "vugen-profile=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
}

export async function handleSessionGet(req, res) {
  const profile = getProfileFromCookie(req);
  const valid = profile ? await profileExists(profile) : false;
  sendJson(res, 200, { profile: valid ? profile : null });
}

export async function handleSessionPost(req, res) {
  const body = await readJsonBody(req);
  const name = typeof body?.profile === "string" ? body.profile.trim() : "";
  if (!name) return sendError(res, 400, "Field 'profile' wajib diisi");
  if (!(await profileExists(name))) return sendError(res, 404, `Profile "${name}" tidak ditemukan`);
  setCookie(res, name);
  sendJson(res, 200, { profile: name });
}

export async function handleSessionDelete(_req, res) {
  clearCookie(res);
  sendJson(res, 200, { ok: true });
}

export async function handleProfilesGet(_req, res) {
  sendJson(res, 200, { profiles: await listProfiles() });
}

export async function handleProfilesPost(req, res) {
  if (req.profile !== "admin") return sendError(res, 403, "Hanya admin yang dapat menambah profile");
  const body = await readJsonBody(req);
  const name = typeof body?.name === "string" ? body.name.trim().toLowerCase() : "";
  const err = validateProfileName(name);
  if (err) return sendError(res, 400, err);
  const profiles = await listProfiles();
  if (profiles.includes(name)) return sendError(res, 409, `Profile "${name}" sudah ada`);
  await saveProfiles([...profiles, name].sort());
  sendJson(res, 201, { profile: name });
}

export async function handleProfilesDelete(req, res, _url, { name }) {
  if (req.profile !== "admin") return sendError(res, 403, "Hanya admin yang dapat menghapus profile");
  const profiles = await listProfiles();
  if (!profiles.includes(name)) return sendError(res, 404, `Profile "${name}" tidak ditemukan`);
  await saveProfiles(profiles.filter((p) => p !== name));
  sendJson(res, 200, { ok: true });
}
