/**
 * Mock HTTP server untuk tes F3 (plan §9).
 *
 * Melayani:
 * - GET  /              -> HTML sederhana dengan form login + CSRF token
 * - POST /login         -> Validasi user/csrf, set cookie, redirect ke /dashboard
 * - GET  /dashboard     -> Halaman setelah login
 * - GET  /slow          -> Menjawab setelah 10 detik (untuk tes Stop)
 * - GET  /status/:code  -> Menjawab dengan status HTTP tertentu (untuk tes step gagal)
 * - GET  /echo-headers  -> Mengembalikan header request sebagai JSON (untuk tes header/cookie)
 *
 * Dipakai oleh runner test tanpa server eksternal.
 */

import { createServer } from "node:http";
import { parse } from "node:url";

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(";")) {
    const [key, ...val] = part.split("=");
    cookies[key.trim()] = val.join("=").trim();
  }
  return cookies;
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

function parseForm(body) {
  const params = new URLSearchParams(body);
  const result = {};
  for (const [k, v] of params) result[k] = v;
  return result;
}

const csrfTokens = new Map(); // sessionId -> token

function generateCsrf() {
  return "csrf_" + Math.random().toString(36).slice(2, 10);
}

function getSessionId(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies.session_id || null;
}

function setSessionCookie(res, sessionId) {
  res.setHeader("Set-Cookie", `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax`);
}

const server = createServer(async (req, res) => {
  const url = parse(req.url, true);
  const method = req.method;
  const sessionId = getSessionId(req);

  // CORS for local testing
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /
  if (method === "GET" && url.pathname === "/") {
    const token = generateCsrf();
    const newSessionId = "sess_" + Math.random().toString(36).slice(2);
    csrfTokens.set(newSessionId, token);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    setSessionCookie(res, newSessionId);

    res.writeHead(200);
    res.end(`
<!DOCTYPE html>
<html>
<head><title>Mock Login</title></head>
<body>
  <h1>Mock Login Page</h1>
  <form method="POST" action="/login">
    <input type="hidden" name="csrf" value="${token}">
    <label>User: <input name="user" value="demo"></label><br>
    <label>Pass: <input name="pass" type="password" value="secret"></label><br>
    <button type="submit">Login</button>
  </form>
</body>
</html>
    `);
    return;
  }

  // POST /login
  if (method === "POST" && url.pathname === "/login") {
    const body = await parseBody(req);
    const form = parseForm(body);
    const { user, pass, csrf } = form;

    const token = sessionId ? csrfTokens.get(sessionId) : null;
    const validCsrf = token && csrf === token;
    const validCreds = user === "demo" && pass === "secret";

    if (validCsrf && validCreds) {
      // Success: set auth cookie, redirect to dashboard
      const authSession = "auth_" + Math.random().toString(36).slice(2);
      res.setHeader("Set-Cookie", [
        `session_id=${authSession}; Path=/; HttpOnly; SameSite=Lax`,
        `auth_token=valid_${authSession}; Path=/; HttpOnly; SameSite=Lax`,
      ]);
      res.writeHead(302, { Location: "/dashboard" });
      res.end("Redirecting...");
      return;
    }

    // Fail: return error page
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.writeHead(401);
    res.end(`
<!DOCTYPE html>
<html>
<head><title>Login Failed</title></head>
<body>
  <h1>Login Failed</h1>
  <p>Invalid credentials or CSRF token.</p>
  <p>csrf received: ${csrf}</p>
  <p>csrf expected: ${token}</p>
  <p>user: ${user}</p>
  <a href="/">Back</a>
</body>
</html>
    `);
    return;
  }

  // GET /dashboard
  if (method === "GET" && url.pathname === "/dashboard") {
    const cookies = parseCookies(req.headers.cookie);
    const authToken = cookies.auth_token;

    if (authToken?.startsWith("valid_")) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.writeHead(200);
      res.end(`
<!DOCTYPE html>
<html>
<head><title>Dashboard</title></head>
<body>
  <h1>Dashboard</h1>
  <p>Welcome, ${authToken}!</p>
  <p><a href="/logout">Logout</a></p>
</body>
</html>
      `);
      return;
    }

    // Not authenticated
    res.writeHead(302, { Location: "/" });
    res.end("Redirecting to login...");
    return;
  }

  // GET /status/:code — status HTTP sembarang
  const statusMatch = /^\/status\/(\d{3})$/.exec(url.pathname);
  if (statusMatch) {
    res.writeHead(Number(statusMatch[1]), { "Content-Type": "text/plain" });
    res.end(`status ${statusMatch[1]}`);
    return;
  }

  // GET /echo-headers — header request dikembalikan sebagai JSON
  if (url.pathname === "/echo-headers") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(req.headers));
    return;
  }

  // GET /slow — jawaban lambat; dipakai tes Stop/killAllRuns
  if (method === "GET" && url.pathname === "/slow") {
    const timer = setTimeout(() => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("slow ok");
    }, 10_000);
    res.on("close", () => clearTimeout(timer));
    return;
  }

  // GET /logout
  if (method === "GET" && url.pathname === "/logout") {
    res.setHeader("Set-Cookie", [
      "session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      "auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ]);
    res.writeHead(302, { Location: "/" });
    res.end();
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

let serverInstance = null;

export function startMockServer(port = 18081) {
  return new Promise((resolve) => {
    serverInstance = server.listen(port, '127.0.0.1', () => {
      console.log(`[mock] Server running on http://127.0.0.1:${port}`);
      resolve({ port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

export function stopMockServer() {
  return new Promise((resolve) => {
    if (serverInstance) {
      serverInstance.closeAllConnections?.();
      serverInstance.close(() => {
        serverInstance = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// Auto-start if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startMockServer(18080).catch(console.error);
}

export default { startMockServer, stopMockServer };