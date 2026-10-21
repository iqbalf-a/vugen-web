/**
 * src/utils/fileGroups.js — Pengelompokan file di panel Script Files (mengikuti model VuGen).
 */

/** @typedef {{ path: string, name: string, ext: string, category?: string, order?: number, state?: string, calledBy?: string[] }} FileItem */

export const FILE_GROUPS = [
  { id: "actions", label: "Actions", hint: "Active actions are in Run Logic; passive actions run only when called" },
  { id: "extra", label: "Extra Files", hint: "Headers, .js and other assets the script can load" },
  { id: "data", label: "Data", hint: "Parameter definitions and data files" },
  { id: "settings", label: "Settings", hint: "Script and run-time settings" },
];

/**
 * @param {FileItem[]} files
 * @returns {Array<{ id: string, label: string, hint: string, files: FileItem[] }>} hanya grup yang berisi
 */
export function groupFiles(files) {
  const known = new Set(FILE_GROUPS.map(group => group.id));
  return FILE_GROUPS.map(group => ({
    ...group,
    files: files
      .filter(file => (known.has(file.category ?? "") ? file.category : "settings") === group.id)
      .sort((a, b) => compareInGroup(group.id, a, b)),
  })).filter(group => group.files.length > 0);
}

/** @param {string} groupId @param {FileItem} a @param {FileItem} b */
function compareInGroup(groupId, a, b) {
  if (groupId === "actions") return (a.order ?? 0) - (b.order ?? 0);
  if (groupId === "data") {
    const aPrm = a.ext === ".prm" ? 0 : 1;
    const bPrm = b.ext === ".prm" ? 0 : 1;
    if (aPrm !== bPrm) return aPrm - bPrm;
  }
  return a.name.localeCompare(b.name);
}

/** Tooltip file; untuk action menjelaskan status aktif/pasif dan siapa pemanggilnya. */
export function fileTitle(file) {
  if (file.category !== "actions") return file.path;
  if (file.state === "unlinked") return `${file.path} — not listed as an action in the script`;
  if (file.state === "passive") {
    const callers = (file.calledBy ?? []).map(path => path.replace(/\.c$/i, ""));
    return `${file.path} — passive: runs only when called${callers.length ? ` (from ${callers.join(", ")})` : "; no action calls it"}`;
  }
  return `${file.path} — active: part of Run Logic`;
}
