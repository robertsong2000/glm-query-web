#!/usr/bin/env node
/**
 * Token Plan 用量查询本地代理服务
 *
 * 解决浏览器直接请求 GLM / Kimi / MiniMax API 时的跨域限制。
 * 提供静态文件服务，并根据前端传来的 X-Target-Host 头转发到对应域名。
 *
 * 用法：
 *   node server.mjs
 *   然后打开 http://localhost:3456
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3456;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept-Language, Accept, X-Target-Host",
};

async function serveStatic(req, res) {
  let urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.join(__dirname, urlPath);
  const ext = path.extname(filePath).toLowerCase();

  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(content);
  } catch (err) {
    if (err.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    } else {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(String(err));
    }
  }
}

function proxyRequest(req, res) {
  const targetHost = req.headers["x-target-host"];
  if (!targetHost) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, msg: "Missing X-Target-Host header" }));
    return;
  }

  const targetUrl = new URL(req.url, `https://${targetHost}`);
  console.log(`[Proxy] ${req.method} ${targetUrl.toString()}`);

  const options = {
    hostname: targetHost,
    port: 443,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetHost,
    },
  };

  // 删除浏览器自动加入、可能干扰转发的头
  delete options.headers["origin"];
  delete options.headers["referer"];
  delete options.headers["x-target-host"];

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      ...CORS_HEADERS,
    });
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error(`[Proxy -> ${targetHost}] error:`, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, msg: `Proxy error: ${err.message}` }));
    }
  });

  req.pipe(proxyReq);
}

function isApiRequest(pathname) {
  return (
    pathname === "/api/monitor/usage/quota/limit" ||
    pathname === "/coding/v1/usages" ||
    pathname === "/v1/api/openplatform/coding_plan/remains"
  );
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

  if (isApiRequest(pathname) || req.headers["x-target-host"]) {
    proxyRequest(req, res);
  } else {
    void serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`Token Plan 用量查询服务已启动：http://localhost:${PORT}`);
  console.log("支持供应商：GLM / Kimi / MiniMax");
  console.log("按 Ctrl+C 停止服务");
});
