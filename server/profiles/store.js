import { promises as fs } from "node:fs";
import path from "node:path";

const PROFILES_FILE = path.resolve(process.cwd(), "profiles.json");

export async function listProfiles() {
  try {
    const raw = await fs.readFile(PROFILES_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveProfiles(profiles) {
  await fs.writeFile(PROFILES_FILE, JSON.stringify(profiles, null, 2) + "\n", "utf8");
}

/** "admin" selalu valid tapi tidak tersimpan di file */
export async function profileExists(name) {
  if (name === "admin") return true;
  const profiles = await listProfiles();
  return profiles.includes(name);
}

/** Kembalikan pesan error bila nama tidak valid, null bila OK */
export function validateProfileName(name) {
  if (typeof name !== "string" || name.trim() === "") return "Profile name is required";
  const n = name.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(n)) return "Profile name: 2–32 characters, lowercase letters/digits/dash/underscore";
  if (n === "admin") return "The name 'admin' is reserved";
  return null;
}
