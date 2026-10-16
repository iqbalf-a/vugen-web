/**
 * HTTP Client untuk runtime VuGen.
 *
 * Menggunakan undici + tough-cookie.
 * - Redirect manual (catat tiap hop)
 * - Timeout per request
 * - Opsi insecureTLS
 * - Cookie jar per virtual user (dibersihkan saat newUserEachIteration)
 *
 * @module http-client
 */

import { performance } from "node:perf_hooks";

import { request, Agent } from "undici";
import { CookieJar } from "tough-cookie";

/**
 * @typedef {Object} HttpClientOptions
 * @property {number} [timeoutMs=60000]
 * @property {number} [connectTimeoutMs=10000]
 * @property {boolean} [insecureTLS=false]
 * @property {boolean} [followRedirects=false] // manual redirect, default false
 * @property {number} [maxRedirects=10]
 * @property {(level: string, msg: string) => void} [debugCallback]
 */

/**
 * @typedef {Object} RequestOptions
 * @property {string} method
 * @property {string} url
 * @property {Record<string, string>} [headers={}]
 * @property {string|Buffer} [body]
 * @property {boolean} [followRedirects=false]
 * @property {number} [maxRedirects=10]
 * @property {number} [timeoutMs] // override timeout per request
 */

/**
 * @typedef {Object} ResponseInfo
 * @property {number} status
 * @property {string} statusText
 * @property {Record<string, string>} headers
 * @property {string} contentType
 * @property {number} size
 * @property {Buffer} body
 * @property {Object[]} redirectChain - [{ url, status, headers }]
 * @property {number} durationMs - total waktu request (termasuk redirect), milidetik
 * @property {number} startedAt - epoch ms request pertama dikirim
 * @property {{ method: string, url: string, headers: Record<string, string>, body?: string|Buffer }} request - request asli (hop pertama, header sudah termasuk Cookie)
 */

/**
 * Jar baru. `DOMAIN=<IP>` (umum di web_add_cookie script KOPRA) ditolak tough-cookie sebagai
 * "public suffix"; untuk load test proteksi itu dimatikan.
 */
function newCookieJar() {
  return new CookieJar(undefined, { rejectPublicSuffixes: false });
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class HttpClient {
  /**
   * @param {HttpClientOptions} options
   */
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10000;
    this.insecureTLS = options.insecureTLS ?? false;
    this.debugCallback = options.debugCallback ?? null;
    this.defaultFollowRedirects = options.followRedirects ?? false;
    this.maxRedirects = options.maxRedirects ?? 10;

    // Opsi koneksi/TLS undici ada di `connect` (bukan `tls` / `connectTimeout` per request).
    /** @type {Agent} */
    this.agent = new Agent({
      connections: 10,
      connect: {
        timeout: this.connectTimeoutMs,
        ...(this.insecureTLS ? { rejectUnauthorized: false } : {}),
      },
    });

    /** @type {CookieJar} */
    this.cookieJar = newCookieJar();

    /** URL request terakhir; konteks default `web_add_cookie` */
    this.lastUrl = "";
  }

  /** Hapus semua cookie (user baru / web_cleanup_cookies) */
  clearCookies() {
    this.cookieJar = newCookieJar();
  }

  /**
   * Tambah cookie ala `web_add_cookie`.
   *
   * @param {string} cookieString - mis. "name=value; Domain=example.com; Path=/; Secure"
   * @param {string} url - URL konteks cookie
   * @returns {Promise<{ ok: boolean, error?: string }>} ok=false bila cookie ditolak
   */
  async addCookie(cookieString, url) {
    try {
      await this.cookieJar.setCookie(cookieString, new URL(url).href);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Eksekusi request HTTP dengan redirect manual (tiap hop dicatat).
   *
   * @param {RequestOptions} opts
   * @returns {Promise<ResponseInfo>}
   */
  async doRequest(opts) {
    const { method, url, headers = {}, body, followRedirects = this.defaultFollowRedirects, maxRedirects = this.maxRedirects } = opts;
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;

    this.lastUrl = url;

    const startedAt = Date.now();
    const startedPerf = performance.now();
    const redirectChain = [];
    let currentUrl = url;
    let currentMethod = method;
    let currentBody = body;
    const currentHeaders = { ...headers };
    let redirectCount = 0;
    /** @type {ResponseInfo["request"]|null} */
    let sentRequest = null;

    for (;;) {
      const cookieHeader = await this.cookieJar.getCookieString(new URL(currentUrl).href);
      if (cookieHeader) currentHeaders.Cookie = cookieHeader;

      if (!sentRequest) {
        sentRequest = { method: currentMethod, url: currentUrl, headers: { ...currentHeaders }, body: currentBody };
      }
      this.debugCallback?.("info", `[http-client] ${currentMethod} ${currentUrl}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await request(currentUrl, {
          method: currentMethod,
          headers: currentHeaders,
          body: currentBody,
          dispatcher: this.agent,
          signal: controller.signal,
        });
        const bodyBuffer = Buffer.from(await response.body.arrayBuffer());

        this.debugCallback?.("info", `[http-client] ${currentMethod} ${currentUrl} -> ${response.statusCode} (${bodyBuffer.length} bytes)`);

        // Simpan cookie dari response
        const setCookie = response.headers["set-cookie"];
        if (setCookie) {
          for (const cookie of Array.isArray(setCookie) ? setCookie : [setCookie]) {
            try {
              await this.cookieJar.setCookie(cookie, new URL(currentUrl).href);
            } catch {
              // Cookie tidak valid diabaikan seperti browser
            }
          }
        }

        const location = response.headers.location;
        if (REDIRECT_STATUSES.has(response.statusCode) && location && followRedirects && redirectCount < maxRedirects) {
          redirectChain.push({ url: currentUrl, status: response.statusCode, headers: this._normalizeHeaders(response.headers) });
          redirectCount++;
          currentUrl = new URL(location, currentUrl).href;

          // 301/302/303: ubah ke GET dan buang body (perilaku browser); 307/308 mempertahankan method & body
          if ([301, 302, 303].includes(response.statusCode)) {
            currentMethod = "GET";
            currentBody = undefined;
            for (const name of Object.keys(currentHeaders)) {
              if (["content-length", "content-type"].includes(name.toLowerCase())) delete currentHeaders[name];
            }
          }
          continue;
        }

        return {
          status: response.statusCode,
          statusText: response.statusMessage || "",
          headers: this._normalizeHeaders(response.headers),
          contentType: response.headers["content-type"] || "",
          size: bodyBuffer.length,
          body: bodyBuffer,
          redirectChain,
          durationMs: Math.round((performance.now() - startedPerf) * 100) / 100,
          startedAt,
          request: sentRequest,
        };
      } catch (error) {
        this.debugCallback?.("error", `[http-client] ${currentMethod} ${currentUrl} failed: ${error.message}`);
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Normalize headers to Record<string, string>
   * @param {Record<string, string|string[]>} headers
   * @returns {Record<string, string>}
   */
  _normalizeHeaders(headers) {
    const result = {};
    for (const [key, value] of Object.entries(headers)) {
      result[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
    }
    return result;
  }

  /** Tutup koneksi agent (maks 5 detik) */
  async close() {
    try {
      await Promise.race([
        this.agent.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("close timeout")), 5000)),
      ]);
    } catch (error) {
      // Agent mungkin sudah tertutup / masih ada request tertunda
      this.debugCallback?.("debug", `[http-client] close warning: ${error.message}`);
    }
  }
}
