/**
 * runtime/printf.js — Format string ala C `printf` untuk `sprintf`, `lr_output_message`
 * dan `lr_error_message`.
 *
 * Didukung: `%s %c %d %i %u %o %x %X %f %F %e %E %g %G %%`, flag `- + spasi 0 #`,
 * lebar, presisi (`.N`), dan modifier panjang (`l ll h hh L z j t`) yang diabaikan.
 * Spesifikasi lain (mis. `%*d`, `%n`, `%p`) dibiarkan apa adanya.
 */

const SPEC = /%([-+ 0#]*)(\d+)?(?:\.(\d*))?(?:hh|h|ll|l|L|z|j|t)?([diuoxXeEfFgGcs%])/g;

/** Argumen -> integer C (terpotong); nilai non-numerik jadi 0. */
function toInteger(arg) {
  const n = Math.trunc(Number(arg));
  return Number.isFinite(n) ? n : 0;
}

/** Argumen -> double C; nilai non-numerik jadi 0. */
function toFloat(arg) {
  const n = Number(arg);
  return Number.isFinite(n) ? n : 0;
}

/** Eksponen gaya C: minimal dua digit (`1.5e+00`). */
function exponentialC(value, digits, upper) {
  const text = value.toExponential(digits).replace(/e([+-])(\d)$/, "e$10$2");
  return upper ? text.toUpperCase() : text;
}

/** `%g`: pilih notasi tetap/eksponensial, buang nol di belakang (kecuali flag `#`). */
function generalC(value, precision, flags, upper) {
  const p = precision === undefined ? 6 : precision === 0 ? 1 : precision;
  if (value === 0) return flags.includes("#") ? (0).toFixed(p - 1) : "0";
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  let text;
  if (exponent < -4 || exponent >= p) {
    text = exponentialC(value, p - 1, false);
    if (!flags.includes("#")) text = text.replace(/\.?0+e/, "e");
  } else {
    text = value.toFixed(Math.max(0, p - 1 - exponent));
    if (!flags.includes("#") && text.includes(".")) text = text.replace(/\.?0+$/, "");
  }
  return upper ? text.toUpperCase() : text;
}

/** Awalan tanda untuk angka bertanda. */
function signPrefix(negative, flags) {
  if (negative) return "-";
  if (flags.includes("+")) return "+";
  if (flags.includes(" ")) return " ";
  return "";
}

/**
 * @param {unknown} format
 * @param {unknown[]} [args]
 * @returns {string}
 */
export function formatPrintf(format, args = []) {
  let index = 0;

  return String(format ?? "").replace(SPEC, (match, flags, width, precisionText, conv) => {
    if (conv === "%") return "%";

    const arg = args[index++];
    const precision = precisionText === undefined ? undefined : Number(precisionText || 0);
    let sign = "";
    let digits;
    let numeric = true;

    switch (conv) {
      case "s":
        numeric = false;
        digits = arg === undefined || arg === null ? "" : String(arg);
        if (precision !== undefined) digits = digits.slice(0, precision);
        break;
      case "c":
        numeric = false;
        digits = typeof arg === "number" ? String.fromCharCode(arg) : String(arg ?? "").charAt(0);
        break;
      case "d":
      case "i": {
        const n = toInteger(arg);
        sign = signPrefix(n < 0, flags);
        digits = Math.abs(n).toString();
        if (precision !== undefined) digits = digits.padStart(precision, "0");
        break;
      }
      case "u":
      case "o":
      case "x":
      case "X": {
        const n = toInteger(arg) >>> 0;
        const radix = conv === "u" ? 10 : conv === "o" ? 8 : 16;
        digits = n.toString(radix);
        if (precision !== undefined) digits = digits.padStart(precision, "0");
        if (conv === "X") digits = digits.toUpperCase();
        if (flags.includes("#") && n !== 0) sign = conv === "o" ? "0" : conv === "x" ? "0x" : conv === "X" ? "0X" : "";
        break;
      }
      case "f":
      case "F": {
        const n = toFloat(arg);
        sign = signPrefix(n < 0 || Object.is(n, -0), flags);
        digits = Math.abs(n).toFixed(precision ?? 6);
        break;
      }
      case "e":
      case "E": {
        const n = toFloat(arg);
        sign = signPrefix(n < 0, flags);
        digits = exponentialC(Math.abs(n), precision ?? 6, conv === "E");
        break;
      }
      default: {
        // g, G
        const n = toFloat(arg);
        sign = signPrefix(n < 0, flags);
        digits = generalC(Math.abs(n), precision, flags, conv === "G");
        break;
      }
    }

    const size = Number(width ?? 0);
    const length = sign.length + digits.length;
    if (length >= size) return sign + digits;

    const padding = size - length;
    if (flags.includes("-")) return sign + digits + " ".repeat(padding);
    // Flag 0 hanya berlaku untuk angka, dan diabaikan bila presisi integer diberikan (aturan C).
    const zeroPad = flags.includes("0") && numeric && !("diuoxX".includes(conv) && precision !== undefined);
    return zeroPad ? sign + "0".repeat(padding) + digits : " ".repeat(padding) + sign + digits;
  });
}
