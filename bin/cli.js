#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const distDir = join(__dirname, "..", "dist");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function getMimeType(filePath) {
  return MIME_TYPES[extname(filePath)] || "application/octet-stream";
}

async function serveFile(res, filePath) {
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": getMimeType(filePath) });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${cmd} ${url}`);
}

function tryListen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve(false);
      } else {
        reject(err);
      }
    });
    server.listen(port, () => resolve(true));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;

  // Serve static files from dist/
  if (pathname !== "/" && pathname !== "") {
    const filePath = join(distDir, pathname);
    if (await serveFile(res, filePath)) return;
  }

  // SPA fallback — serve index.html for all unresolved routes
  const indexPath = join(distDir, "index.html");
  if (await serveFile(res, indexPath)) return;

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

const preferredPort = 3000;

async function start() {
  let port = preferredPort;

  if (await tryListen(server, port)) {
    // Listening on preferred port
  } else {
    // Preferred port busy — let the OS pick one
    server.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    port = server.address().port;
  }

  const url = `http://localhost:${port}`;
  console.log(`\n  CaudalFlow is running at ${url}\n`);
  openBrowser(url);
}

start().catch((err) => {
  console.error("Failed to start CaudalFlow:", err.message);
  process.exit(1);
});
