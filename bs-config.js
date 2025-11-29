const history = require("connect-history-api-fallback");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const PRODUCTS_PATH = "data/products.json";
const LOCAL_PRODUCTS_PATH = "data/products.local.json";
const PRODUCTS_FILE = path.join(ROOT, PRODUCTS_PATH);
const LOCAL_PRODUCTS_FILE = path.join(ROOT, LOCAL_PRODUCTS_PATH);
const DEFAULT_PRODUCTS_CONTENT = JSON.stringify(
  {
    products: [],
    meta: {
      currency: "ARS",
      locale: "es-AR",
      contact: null,
    },
  },
  null,
  2
);
const PRODUCT_PATHS = [
  { path: PRODUCTS_PATH, file: PRODUCTS_FILE, seed: null },
  { path: LOCAL_PRODUCTS_PATH, file: LOCAL_PRODUCTS_FILE, seed: PRODUCTS_FILE },
];

function ensureProductsFile(targetFile, seedFrom = null) {
  if (!fs.existsSync(targetFile)) {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    if (seedFrom && fs.existsSync(seedFrom)) {
      fs.copyFileSync(seedFrom, targetFile);
    } else {
      fs.writeFileSync(targetFile, DEFAULT_PRODUCTS_CONTENT, "utf8");
    }
  }
}

PRODUCT_PATHS.forEach((entry) => ensureProductsFile(entry.file, entry.seed));

function safeResolve(requestPath) {
  if (!requestPath) return null;
  const normalized = requestPath.replace(/^\/+/, "");
  const targetPath = path.resolve(ROOT, normalized);
  if (!targetPath.startsWith(ROOT)) {
    return null;
  }
  const matchedProductPath = PRODUCT_PATHS.find((entry) => path.resolve(ROOT, entry.path) === targetPath);
  if (matchedProductPath) {
    ensureProductsFile(matchedProductPath.file, matchedProductPath.seed);
    return matchedProductPath.file;
  }
  if (normalized.startsWith("data/images/")) {
    const suffix = normalized.slice("data/images/".length);
    const mapped = path.join(ROOT, "data", "images", suffix);
    return mapped;
  }
  return targetPath;
}

function getSha(buffer) {
  return crypto.createHash("sha1").update(buffer).digest("hex");
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString();
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function localApi(req, res, next) {
  const url = new URL(req.url, "http://localhost");
  if (!url.pathname.startsWith("/__dev/api")) {
    next();
    return;
  }

  if (url.pathname === "/__dev/api/contents" && req.method === "GET") {
    const requestedPath = url.searchParams.get("path");
    const filePath = safeResolve(requestedPath);
    if (!filePath) {
      sendJson(res, 400, { message: "Ruta invalida" });
      return;
    }
    if (!fs.existsSync(filePath)) {
      sendJson(res, 404, { message: "Archivo no encontrado" });
      return;
    }
    const buffer = fs.readFileSync(filePath);
    sendJson(res, 200, { content: buffer.toString("base64"), sha: getSha(buffer) });
    return;
  }

  if (url.pathname === "/__dev/api/contents" && req.method === "PUT") {
    parseBody(req)
      .then((body) => {
        const requestedPath = body.path;
        const content = body.content;
        if (!requestedPath || typeof content !== "string") {
          sendJson(res, 400, { message: "Body invalido" });
          return;
        }
        const filePath = safeResolve(requestedPath);
        if (!filePath) {
          sendJson(res, 400, { message: "Ruta invalida" });
          return;
        }
        const buffer = Buffer.from(content, "base64");
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, buffer);
        sendJson(res, 200, { content: { sha: getSha(buffer) } });
      })
      .catch(() => {
        sendJson(res, 400, { message: "Body invalido" });
      });
    return;
  }

  if (url.pathname === "/__dev/api/contents" && req.method === "DELETE") {
    parseBody(req)
      .then((body) => {
        const requestedPath = body.path;
        const filePath = safeResolve(requestedPath);
        if (!filePath) {
          sendJson(res, 400, { message: "Ruta invalida" });
          return;
        }
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        sendJson(res, 200, { ok: true });
      })
      .catch(() => {
        sendJson(res, 400, { message: "Body invalido" });
      });
    return;
  }

  if (url.pathname === "/__dev/api/list" && req.method === "GET") {
    const requestedPath = url.searchParams.get("path");
    const basePath = safeResolve(requestedPath);
    if (!basePath) {
      sendJson(res, 400, { message: "Ruta invalida" });
      return;
    }
    if (!fs.existsSync(basePath)) {
      sendJson(res, 200, []);
      return;
    }
    const entries = fs.readdirSync(basePath, { withFileTypes: true });
    const response = entries.map((entry) => {
      const entryPath = path.join(requestedPath, entry.name).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        return { path: entryPath, type: "dir", sha: null };
      }
      const buffer = fs.readFileSync(path.join(basePath, entry.name));
      return { path: entryPath, type: "file", sha: getSha(buffer) };
    });
    sendJson(res, 200, response);
    return;
  }

  sendJson(res, 404, { message: "Endpoint no disponible" });
}

module.exports = {
  server: {
    baseDir: "./",
    middleware: [localApi, history({
      index: "/index.html",
      rewrites: [
        { from: /^\/admin$/, to: "/admin/index.html" },
        { from: /^\/admin\/$/, to: "/admin/index.html" },
      ],
    })],
  },
};

