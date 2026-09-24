const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = Number(process.env.PORT) || 5000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const EVENTS_FILE = path.join(DATA_DIR, "events.json");
const CONTENT_FILE = path.join(DATA_DIR, "site-content.json");
const UPLOADS_DIR = path.join(ROOT, "attached_assets", "uploads");
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "").trim();
const adminSessions = new Map();
const DEFAULT_CONTENT = {
  verse: {
    text: "The people who walked in darkness have seen a great light; those who dwelt in the land of the shadow of death, upon them a light has shined.",
    reference: "Isaiah 9:2 · Our foundation",
    encouragement: "Even in seasons that feel heavy, God is still present, still faithful, and still making a way forward. May His light give you courage for today, peace for tomorrow, and hope that reaches beyond what you can see.",
  },
  gallery: [],
};
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

function readRequestBody(request, maxBytes = 12_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error("This upload is too large. Please choose a smaller file."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch { reject(new Error("Please send valid form data.")); }
    });
    request.on("error", reject);
  });
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function getContent() {
  const stored = readJsonFile(CONTENT_FILE, {});
  return {
    verse: { ...DEFAULT_CONTENT.verse, ...(stored.verse || {}) },
    gallery: Array.isArray(stored.gallery) ? stored.gallery : [],
  };
}

function getCookie(request, name) {
  const cookies = String(request.headers.cookie || "").split(";").map((part) => part.trim());
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function createAdminSession() {
  const token = crypto.randomBytes(32).toString("hex");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(token).digest("hex");
  const sessionId = `${token}.${signature}`;
  adminSessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
  return sessionId;
}

function isAdmin(request) {
  if (!SESSION_SECRET || !ADMIN_PASSWORD) return false;
  const session = getCookie(request, "great_light_admin");
  const [token, signature] = session.split(".");
  if (!token || !signature || !adminSessions.has(token)) return false;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(token).digest("hex");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  const expiresAt = adminSessions.get(token);
  if (expiresAt < Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function compareSecret(input, expected) {
  const received = Buffer.from(String(input || ""));
  const stored = Buffer.from(String(expected || ""));
  return received.length === stored.length && crypto.timingSafeEqual(received, stored);
}

function sendUnauthorized(response, message = "Admin sign-in is required.") {
  return sendJson(response, 401, { error: message });
}

function validateEvent(data, existing = {}) {
  const event = {
    id: existing.id || crypto.randomUUID(),
    title: String(data.title || "").trim(),
    date: String(data.date || "").trim(),
    time: String(data.time || "").trim(),
    location: String(data.location || "").trim(),
    description: String(data.description || "").trim(),
    link: String(data.link || "").trim(),
  };
  if (!event.title || !event.date || !event.time || !event.location || !event.description) {
    return { error: "Title, date, time, location, and description are required." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date)) return { error: "Please choose a valid event date." };
  if (event.title.length > 120 || event.time.length > 80 || event.location.length > 160 || event.description.length > 500 || event.link.length > 300) {
    return { error: "One of the event fields is too long." };
  }
  if (event.link && !/^https?:\/\//i.test(event.link)) return { error: "Event links must start with https:// or http://." };
  return { event };
}

function handleAdminLogin(request, response, data) {
  if (!ADMIN_PASSWORD) return sendJson(response, 503, { error: "Admin access is not configured. Add an ADMIN_PASSWORD secret first." });
  if (!SESSION_SECRET) return sendJson(response, 503, { error: "Admin sessions are not configured. Add a SESSION_SECRET secret first." });
  if (!compareSecret(data.password, ADMIN_PASSWORD)) return sendUnauthorized(response, "That admin password is not correct.");
  const sessionId = createAdminSession();
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": `great_light_admin=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`,
  });
  return response.end(JSON.stringify({ ok: true }));
}

function handleAdminLogout(response) {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": "great_light_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
  });
  return response.end(JSON.stringify({ ok: true }));
}

async function handleAdminEvent(request, response, eventId = "") {
  if (!isAdmin(request)) return sendUnauthorized(response);
  const events = readJsonFile(EVENTS_FILE, []);
  if (request.method === "GET") return sendJson(response, 200, { events });
  const data = await readRequestBody(request);
  if (request.method === "DELETE") {
    const remaining = events.filter((event) => event.id !== eventId);
    if (remaining.length === events.length) return sendJson(response, 404, { error: "Event not found." });
    writeJsonFile(EVENTS_FILE, remaining);
    return sendJson(response, 200, { ok: true, events: remaining });
  }
  const result = validateEvent(data, eventId ? (events.find((event) => event.id === eventId) || {}) : {});
  if (result.error) return sendJson(response, 400, { error: result.error });
  if (request.method === "POST") {
    events.push(result.event);
    events.sort((a, b) => a.date.localeCompare(b.date));
    writeJsonFile(EVENTS_FILE, events);
    return sendJson(response, 201, { ok: true, event: result.event, events });
  }
  if (request.method === "PUT") {
    const index = events.findIndex((event) => event.id === eventId);
    if (index === -1) return sendJson(response, 404, { error: "Event not found." });
    events[index] = result.event;
    events.sort((a, b) => a.date.localeCompare(b.date));
    writeJsonFile(EVENTS_FILE, events);
    return sendJson(response, 200, { ok: true, event: result.event, events });
  }
  return sendJson(response, 405, { error: "Method not allowed" });
}

async function handleAdminContent(request, response) {
  if (!isAdmin(request)) return sendUnauthorized(response);
  const content = getContent();
  if (request.method === "GET") return sendJson(response, 200, content);
  const data = await readRequestBody(request);
  const verse = {
    text: String(data.text || "").trim(),
    reference: String(data.reference || "").trim(),
    encouragement: String(data.encouragement || "").trim(),
  };
  if (!verse.text || !verse.reference || !verse.encouragement) return sendJson(response, 400, { error: "Verse, reference, and encouragement are all required." });
  if (verse.text.length > 800 || verse.reference.length > 120 || verse.encouragement.length > 1200) return sendJson(response, 400, { error: "One of the content fields is too long." });
  const updated = { ...content, verse };
  writeJsonFile(CONTENT_FILE, updated);
  return sendJson(response, 200, updated);
}

async function handleAdminUpload(request, response) {
  if (!isAdmin(request)) return sendUnauthorized(response);
  const data = await readRequestBody(request);
  const match = String(data.data || "").match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  const title = String(data.title || "").trim();
  const alt = String(data.alt || title).trim();
  if (!match || !title || !alt) return sendJson(response, 400, { error: "Please choose an image and provide a title and description." });
  if (title.length > 120 || alt.length > 180) return sendJson(response, 400, { error: "The image title or description is too long." });
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 6_000_000) return sendJson(response, 400, { error: "Images must be smaller than 6 MB." });
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[match[1]];
  const filename = `${crypto.randomUUID()}.${extension}`;
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  const content = getContent();
  const image = { id: crypto.randomUUID(), title, alt, src: `attached_assets/uploads/${filename}`, uploadedAt: new Date().toISOString() };
  const updated = { ...content, gallery: [image, ...content.gallery] };
  writeJsonFile(CONTENT_FILE, updated);
  return sendJson(response, 201, { image, gallery: updated.gallery });
}

async function handleAdminGalleryDelete(request, response, imageId) {
  if (!isAdmin(request)) return sendUnauthorized(response);
  const content = getContent();
  const image = content.gallery.find((entry) => entry.id === imageId);
  if (!image) return sendJson(response, 404, { error: "Image not found." });
  const relativePath = String(image.src || "").replace(/^attached_assets[\\/]/, "");
  const imagePath = path.normalize(path.join(ROOT, "attached_assets", relativePath.replace(/^uploads[\\/]/, "uploads/")));
  if (imagePath.startsWith(UPLOADS_DIR) && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
  const gallery = content.gallery.filter((entry) => entry.id !== imageId);
  writeJsonFile(CONTENT_FILE, { ...content, gallery });
  return sendJson(response, 200, { gallery });
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
  if (request.method === "GET" && requestUrl.pathname === "/api/events") return sendJson(response, 200, { events: readJsonFile(EVENTS_FILE, []) });
  if (request.method === "GET" && requestUrl.pathname === "/api/content") return sendJson(response, 200, getContent());
  if (request.method === "POST" && requestUrl.pathname === "/api/admin/login") {
    try { return handleAdminLogin(request, response, await readRequestBody(request)); } catch (error) { return sendJson(response, 400, { error: error.message }); }
  }
  if (request.method === "POST" && requestUrl.pathname === "/api/admin/logout") return handleAdminLogout(response);
  if (request.method === "GET" && requestUrl.pathname === "/api/admin/session") return sendJson(response, 200, { authenticated: isAdmin(request) });
  if (requestUrl.pathname === "/api/admin/content") {
    try { return await handleAdminContent(request, response); } catch (error) { return sendJson(response, 400, { error: error.message || "Unable to update website content." }); }
  }
  if (request.method === "POST" && requestUrl.pathname === "/api/admin/upload") {
    try { return await handleAdminUpload(request, response); } catch (error) { return sendJson(response, 400, { error: error.message || "Unable to upload image." }); }
  }
  if (request.method === "DELETE" && requestUrl.pathname.startsWith("/api/admin/gallery/")) {
    try { return await handleAdminGalleryDelete(request, response, requestUrl.pathname.split("/").pop()); } catch (error) { return sendJson(response, 400, { error: error.message || "Unable to delete image." }); }
  }
  if (requestUrl.pathname === "/api/admin/events" || requestUrl.pathname.startsWith("/api/admin/events/")) {
    const eventId = requestUrl.pathname.split("/").pop();
    try { return await handleAdminEvent(request, response, eventId === "events" ? "" : eventId); } catch (error) { return sendJson(response, 400, { error: error.message || "Unable to update events." }); }
  }
  if (request.method === "POST" && requestUrl.pathname === "/api/contact") return handleContact(request, response);
  if (request.method === "OPTIONS" && requestUrl.pathname.startsWith("/api/")) {
    response.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return response.end();
  }
  if (requestUrl.pathname.startsWith("/api/")) return sendJson(response, 404, { error: "API route not found." });
  if (request.method === "GET") return serveFile(response, decodeURIComponent(requestUrl.pathname === "/admin" ? "/admin.html" : requestUrl.pathname));
  return sendJson(response, 405, { error: "Method not allowed" });
});

server.listen(PORT, "0.0.0.0", () => console.log(`Great Light Centre is running on port ${PORT}`));