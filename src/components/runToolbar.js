/**
 * Toolbar: input path folder script + riwayat path terakhir (localStorage).
 */

const STORAGE_KEY = "vugen-web:recent-paths";
const MAX_RECENT = 8;

function readRecent() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/**
 * @param {{
 *   input: HTMLInputElement,
 *   datalist: HTMLDataListElement | null,
 *   openButton: HTMLButtonElement,
 *   onOpen: (path: string) => void,
 * }} options
 */
export function createToolbar({ input, datalist, openButton, onOpen }) {
  if (input.value.trim() === "") {
    const [last] = readRecent();
    if (last) input.value = last;
  }

  openButton.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit();
  });

  renderDatalist();

  function submit() {
    const value = input.value.trim();
    if (value === "") return;
    const next = [value, ...readRecent().filter((item) => item !== value)].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    renderDatalist();
    onOpen(value);
  }

  function renderDatalist() {
    if (!datalist) return;
    datalist.replaceChildren(
      ...readRecent().map((value) => {
        const option = document.createElement("option");
        option.value = value;
        return option;
      }),
    );
  }
}
