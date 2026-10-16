/**
 * Toolbar: input path folder script + riwayat path terakhir (localStorage) + run options.
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
 *   runButton: HTMLButtonElement,
 *   stopButton: HTMLButtonElement,
 *   onOpen: (path: string) => void,
 *   onRun: (options: Object) => void,
 *   onStop: () => void,
 *   getIterations: () => number,
 *   getContinueOnError: () => boolean,
 *   getIterationDelay: () => number,
 *   getNewUserEachIteration: () => boolean,
 *   getInsecureTLS: () => boolean,
 *   getThinkTime: () => "ignore" | "run",
 * }} options
 */
export function createToolbar({
  input,
  datalist,
  openButton,
  runButton,
  stopButton,
  onOpen,
  onRun,
  onStop,
  getIterations,
  getContinueOnError,
  getIterationDelay,
  getNewUserEachIteration,
  getInsecureTLS,
  getThinkTime,
}) {
  if (input.value.trim() === "") {
    const [last] = readRecent();
    if (last) input.value = last;
  }

  if (!openButton) {
    console.error("[runToolbar] openButton is null!");
  } else {
    openButton.addEventListener("click", submit);
  }
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit();
  });

  runButton.addEventListener("click", () => {
    const options = {
      iterations: getIterations(),
      continueOnError: getContinueOnError(),
      iterationDelayMs: getIterationDelay(),
      newUserEachIteration: getNewUserEachIteration(),
      insecureTLS: getInsecureTLS(),
      thinkTime: getThinkTime(),
    };
    onRun(options);
  });

  stopButton.addEventListener("click", onStop);

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