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

import { request, Agent } from "undici";
import { CookieJar } from "tough-cookie";

/**
 * @typedef {Object} HttpClientOptions
 * @property {number} [timeoutMs=60000]
 * @property {number} [connectTimeoutMs=10000]
 * @property {boolean} [insecureTLS=false]
 * @property {boolean} [followRedirects=false] // manual redirect, default false
 * @property {number} [maxRedirects=10]
 */

/**
 * @typedef {Object} RequestOptions
 * @property {string} method
 * @property {string} url
 * @property {Record<string, string>} [headers={}]
 * @property {string|Buffer} [body]
 * @property {boolean} [followRedirects=false]
 * @property {number} [maxRedirects=10]
 * @property {number} [connectTimeoutMs] // per-request override
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
 * @property {number} durationMs
 * @property {number} startedAt - epoch ms request pertama dikirim
 * @property {{ method: string, url: string, headers: Record<string, string>, body?: string|Buffer }} request - request asli (hop pertama, header sudah termasuk Cookie)
 */

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

    /** @type {Agent} */
    const agentOptions = { connections: 10 };
    if (this.insecureTLS) {
      // Configure agent to accept self-signed certificates
      agentOptions.tls = { rejectUnauthorized: false };
    }
    this.agent = new Agent(agentOptions);

    /** @type {CookieJar} */
    this.cookieJar = new CookieJar();

    /** @type {string} */
    this.lastUrl = "";
  }

  /**
   * Set cookie jar (used when restoring state across iterations)
   * @param {CookieJar} jar
   */
  setCookieJar(jar) {
    this.cookieJar = jar;
  }

  /**
   * Get current cookie jar (for saving state)
   * @returns {CookieJar}
   */
  getCookieJar() {
    return this.cookieJar;
  }

  /**
   * Clear cookie jar (simulate new user)
   */
  clearCookies() {
    this.cookieJar = new CookieJar();
  }

  /**
   * Add cookie from web_add_cookie style string
   * @param {string} cookieString - e.g. "name=value; domain=.example.com; path=/; secure"
   * @param {string} url - URL context for cookie
   */
  async addCookie(cookieString, url) {
    try {
      const parsedUrl = new URL(url);
      await this.cookieJar.setCookie(cookieString, parsedUrl.href);
    } catch {
      // Silently ignore invalid cookies, like VuGen
    }
  }

  /**
   * Cleanup cookies (web_cleanup_cookies)
   */
  cleanupCookies() {
    this.cookieJar = new CookieJar();
  }

  /**
   * Execute HTTP request with manual redirect handling
   *
   * @param {RequestOptions} opts
   * @returns {Promise<ResponseInfo>}
   */
  async doRequest(opts) {
    const { method, url, headers = {}, body, followRedirects = this.defaultFollowRedirects, maxRedirects = this.maxRedirects } = opts;

    // Store last URL for web_add_cookie
    this.lastUrl = url;

    const startTime = Date.now();
    const redirectChain = [];
    let currentUrl = url;
    let currentMethod = method;
    let currentBody = body;
    let currentHeaders = { ...headers };
    let redirectCount = 0;
    /** @type {ResponseInfo["request"]|null} */
    let sentRequest = null;

    while (true) {
      const parsedUrl = new URL(currentUrl);
      const cookieHeader = await this.cookieJar.getCookieString(parsedUrl.href);
      if (cookieHeader) {
        currentHeaders.Cookie = cookieHeader;
      }

      if (!sentRequest) {
        sentRequest = { method: currentMethod, url: currentUrl, headers: { ...currentHeaders }, body: currentBody };
      }

      if (this.debugCallback) {
        this.debugCallback("info", `[http-client] ${currentMethod} ${currentUrl}`);
      }

      const requestOptions = {
        method: currentMethod,
        headers: currentHeaders,
        body: currentBody,
        dispatcher: this.agent,
        // Timeout handled via AbortController
        connectTimeout: opts.connectTimeoutMs ?? this.connectTimeoutMs,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      let response;
      try {
        response = await request(currentUrl, {
          ...requestOptions,
          signal: controller.signal,
        });

        // Read response body
        const responseBody = await response.body.arrayBuffer();
        const bodyBuffer = Buffer.from(responseBody);

        if (this.debugCallback) {
          this.debugCallback("info", `[http-client] ${currentMethod} ${currentUrl} -> ${response.statusCode} (${bodyBuffer.length} bytes)`);
        }

        // Save cookies from response
        const setCookieHeaders = response.headers["set-cookie"];
        if (setCookieHeaders) {
          const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
          for (const cookie of cookies) {
            try {
              await this.cookieJar.setCookie(cookie, parsedUrl.href);
            } catch {
              // Ignore invalid cookies
            }
          }
        }

        // Build response info
        const contentType = response.headers["content-type"] || "";
        const durationMs = Date.now() - startTime;
        const responseInfo = {
          status: response.statusCode,
          statusText: response.statusMessage || "",
          headers: this._normalizeHeaders(response.headers),
          contentType,
          size: bodyBuffer.length,
          body: bodyBuffer,
          redirectChain: [...redirectChain],
          durationMs,
          startedAt: startTime,
          request: sentRequest,
        };

      // Check for redirect
      const isRedirect = [301, 302, 303, 307, 308].includes(response.statusCode);
      const location = response.headers.location;

      if (isRedirect && location && followRedirects && redirectCount < maxRedirects) {
        redirectChain.push({
          url: currentUrl,
          status: response.statusCode,
          headers: this._normalizeHeaders(response.headers),
        });

        redirectCount++;
        currentUrl = new URL(location, currentUrl).href;

        // For 301/302/303, change method to GET and drop body (browser behavior)
        if ([301, 302, 303].includes(response.statusCode)) {
          currentMethod = "GET";
          currentBody = undefined;
          // Remove content headers
          delete currentHeaders["content-length"];
          delete currentHeaders["content-type"];
        }
        // For 307/308, keep method and body
        continue;
      }

      return responseInfo;
    } catch (error) {
      clearTimeout(timeoutId);
      if (this.debugCallback) {
        this.debugCallback("error", `[http-client] ${currentMethod} ${currentUrl} failed: ${error.message}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  } // end while loop, end doRequest

  /**
   * Normalize headers to Record<string, string>
   * @param {Record<string, string|string[]>} headers
   * @returns {Record<string, string>}
   */
  _normalizeHeaders(headers) {
    const result = {};
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        result[key.toLowerCase()] = value.join(", ");
      } else {
        result[key.toLowerCase()] = value;
      }
    }
    return result;
  }

  /**
   * Close agent connections
   */
  async close() {
    try {
      await Promise.race([
        this.agent.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('close timeout')), 5000))
      ]);
    } catch (error) {
      // Ignore close errors - agent may already be closed or have pending requests
      console.error(`[http-client] Close warning: ${error.message}`);
    }
  }
}

/**
 * Create HttpClient from saved state (for iteration continuity)
 * @param {Object} state
 * @param {Object} state.cookieJar - Serialized CookieJar
 * @param {HttpClientOptions} options
 * @returns {HttpClient}
 */
export function createHttpClientFromState(state, options = {}) {
  const client = new HttpClient(options);
  if (state.cookieJar) {
    client.cookieJar = CookieJar.fromJSON(state.cookieJar);
  }
  return client;
}

export default HttpClient;