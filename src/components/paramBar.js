import { escapeHtml } from "../utils/html.js";

/**
 * Bar di atas editor saat file `.dat` aktif: Select next row, Update value on dan When out of values
 * untuk tiap parameter yang memakai file itu. Nilainya disimpan di `.prm`.
 *
 * "Same line as X": baris mengikuti parameter X, jadi Update value on dan When out of values
 * ikut milik X dan dikunci. Syaratnya jumlah baris sama.
 */

export const SELECT_NEXT_ROW_OPTIONS = [
  { value: "Sequential", label: "Sequential" },
  { value: "Random", label: "Random" },
  { value: "Unique", label: "Unique" },
];

export const UPDATE_OPTIONS = [
  { value: "EachIteration", label: "Each iteration" },
  { value: "EachOccurrence", label: "Each occurrence" },
  { value: "Once", label: "Once" },
];

export const OUT_OF_RANGE_OPTIONS = [
  { value: "Continue", label: "Continue with last value" },
  { value: "Abort", label: "Abort Vuser" },
  { value: "Cycle", label: "Cycle parameter values" },
];

const SAME_PREFIX = "same:";

/** @param {{ file: string }[]} parameters @param {string | null} activePath */
export function parametersForFile(parameters, activePath) {
  if (!activePath || !activePath.toLowerCase().endsWith(".dat")) return [];
  return (parameters ?? []).filter(param => param.file === activePath);
}

/**
 * Parameter yang boleh jadi induk "Same line as": bukan dirinya, bukan pengikut lain,
 * jumlah baris sama, dan dirinya sendiri belum menjadi induk.
 * @param {any} param @param {any[]} all
 */
export function sameLineCandidates(param, all) {
  if (all.some(other => other.selectNextRow === "SameLine" && other.sameLineAs === param.name)) return [];
  return all.filter(other => other.name !== param.name && other.selectNextRow !== "SameLine" && other.rows === param.rows);
}

/** Ubah nilai sebuah select jadi payload perubahan untuk API. */
export function buildChange(field, value) {
  if (field === "selectNextRow" && value.startsWith(SAME_PREFIX)) {
    return { selectNextRow: "SameLine", sameLineAs: value.slice(SAME_PREFIX.length) };
  }
  return { [field]: value };
}

function optionsHtml(options, current) {
  return options
    .map(opt => `<option value="${escapeHtml(opt.value)}"${opt.value === current ? " selected" : ""}>${escapeHtml(opt.label)}</option>`)
    .join("");
}

function selectNextRowHtml(param, all) {
  const follows = param.selectNextRow === "SameLine";
  const candidates = sameLineCandidates(param, all);
  const current = follows ? `${SAME_PREFIX}${param.sameLineAs}` : param.selectNextRow ?? "Sequential";

  const sameOptions = candidates.map(c => ({ value: `${SAME_PREFIX}${c.name}`, label: `Same line as ${c.name}` }));
  if (follows && !sameOptions.some(opt => opt.value === current)) {
    sameOptions.push({ value: current, label: `Same line as ${param.sameLineAs}` });
  }
  const hint = sameOptions.length === 0
    ? `<option disabled>Same line as… (needs another parameter with ${param.rows} rows)</option>`
    : "";
  return optionsHtml([...SELECT_NEXT_ROW_OPTIONS, ...sameOptions], current) + hint;
}

/**
 * @param {HTMLElement} root
 * @param {{ onChange: (name: string, changes: Record<string, string>) => void | Promise<void> }} options
 */
export function createParamBar(root, { onChange }) {
  let lastKey = "";
  let lastState = null;

  root.addEventListener("change", event => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    Promise.resolve(onChange(select.dataset.param ?? "", buildChange(select.dataset.field ?? "", select.value))).catch(() => {
      lastKey = "";
      if (lastState) render(lastState);
    });
  });

  /** @param {{ project: any, activePath: string | null, isRunning: boolean }} state */
  function render(state) {
    lastState = state;
    const { project, activePath, isRunning } = state;
    const all = project?.parameters ?? [];
    const params = parametersForFile(all, activePath);
    const key = JSON.stringify([params, params.map(p => p.sameLineAs && all.find(o => o.name === p.sameLineAs)), all.map(p => [p.name, p.rows, p.selectNextRow, p.sameLineAs]), isRunning]);
    if (key === lastKey) return;
    lastKey = key;

    root.classList.toggle("hidden", params.length === 0);
    if (params.length === 0) {
      root.replaceChildren();
      return;
    }

    root.innerHTML = params.map(param => {
      const editable = Boolean(param.prmFile) && !isRunning;
      const parent = param.selectNextRow === "SameLine" ? all.find(p => p.name === param.sameLineAs) : null;
      const source = parent ?? param;
      const dependents = all.filter(p => p.selectNextRow === "SameLine" && p.sameLineAs === param.name).map(p => `{${p.name}}`);
      const lockTitle = parent ? `Follows {${parent.name}}` : "";
      const noPrmTitle = param.prmFile ? "" : "This column has no entry in a .prm file, so it uses the defaults.";

      const field = (label, name, options, current, locked) => `
        <label class="flex min-w-0 flex-col gap-0.5" title="${escapeHtml(locked ? lockTitle : noPrmTitle)}">
          <span class="text-[11px] text-[#7d8896]">${label}${locked ? ` <span class="text-[#5b6572]">· from {${escapeHtml(parent.name)}}</span>` : ""}</span>
          <select class="ui-field w-full" data-param="${escapeHtml(param.name)}" data-field="${name}"${editable && !locked ? "" : " disabled"}>${options(current)}</select>
        </label>`;

      return `
        <div class="py-1.5 text-[12px]">
          <div class="mb-1 flex items-baseline gap-2">
            <span class="font-mono text-[#e6edf3]">{${escapeHtml(param.name)}}</span>
            <span class="font-mono text-[11px] text-[#5b6572]">${escapeHtml(param.column ?? "")} · ${param.rows} rows</span>
            ${dependents.length ? `<span class="text-[11px] text-[#5b8db8]">leads ${escapeHtml(dependents.join(", "))}</span>` : ""}
          </div>
          <div class="grid grid-cols-3 gap-2">
            ${field("Select next row", "selectNextRow", () => selectNextRowHtml(param, all), null, false)}
            ${field("Update value on", "updateValueOn", cur => optionsHtml(UPDATE_OPTIONS, cur), source.updateValueOn ?? "EachIteration", Boolean(parent))}
            ${field("When out of values", "outOfRangePolicy", cur => optionsHtml(OUT_OF_RANGE_OPTIONS, cur), source.outOfRangePolicy ?? "Cycle", Boolean(parent))}
          </div>
        </div>`;
    }).join("");
  }

  return render;
}
