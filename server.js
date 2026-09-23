const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT) || 5000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(JSON.stringify(payload));
}

function serveFile(response, requestPath) {
  const requested = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(ROOT, requested));
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(filePath).pipe(response);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000) request.destroy();
    });
    request.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch { reject(new Error("Please send valid form data.")); }
    });
    request.on("error", reject);
  });
}

async function handleContact(request, response) {
  try {
    const data = await readRequestBody(request);
    if (data.website) return sendJson(response, 200, { ok: true });
    const name = String(data.name || "").trim();
    const email = String(data.email || "").trim();
    const message = String(data.message || "").trim();
    if (!name || !email || !message) return sendJson(response, 400, { error: "Please complete all the fields." });
    if (name.length > 100 || email.length > 160 || message.length > 3000) return sendJson(response, 400, { error: "One of your entries is too long." });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let messages = [];
    if (fs.existsSync(MESSAGES_FILE)) {
      try { messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf8")); } catch { messages = []; }
    }
    messages.push({ name, email, message, receivedAt: new Date().toISOString() });
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
    return sendJson(response, 201, { ok: true });
  } catch (error) {
    return sendJson(response, 400, { error: error.message || "Unable to receive your message." });
  }
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && requestUrl.pathname === "/api/health") return sendJson(response, 200, { ok: true, service: "great-light-centre" });
  if (request.method === "POST" && requestUrl.pathname === "/api/contact") return handleContact(request, response);
  if (request.method === "OPTIONS" && requestUrl.pathname.startsWith("/api/")) {
    response.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return response.end();
  }
  if (request.method === "GET") return serveFile(response, decodeURIComponent(requestUrl.pathname));
  return sendJson(response, 405, { error: "Method not allowed" });
});

server.listen(PORT, "0.0.0.0", () => console.log(`Great Light Centre is running on port ${PORT}`));