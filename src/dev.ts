/**
 * Local HTTP dev server.
 *
 * Wraps the web-standard `mcpHandler` in a Node `http` server so you can run
 * the remote MCP transport locally without the Vercel CLI:
 *
 *   npm run dev            # http://localhost:3000/mcp
 *
 * Routes:
 *   POST|GET|DELETE /mcp    -> MCP Streamable HTTP endpoint
 *   GET             /health -> { status: "ok" }
 *   GET             /*      -> static files from public/ (landing page, robots, ...)
 *
 * This file is dev-only; on Vercel the handler is mounted by `api/mcp.ts` and
 * static files are served straight from `public/`.
 */

import "./utils/env.js";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname } from "node:path";

import { mcpHandler, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { isConfigured } from "./config.js";
import { logger } from "./utils/logger.js";

const PUBLIC_DIR = new URL("../public/", import.meta.url);

const PORT = Number(process.env.PORT ?? 3000);
const MCP_PATHS = new Set(["/mcp", "/api/mcp"]);
const HEALTH_PATHS = new Set(["/health", "/api/health"]);

const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

/** Serves a file out of `public/` (dev parity with Vercel's static hosting). */
async function serveStatic(res: ServerResponse, relPath: string): Promise<boolean> {
  const safe = relPath.replace(/^\/+/, "").replace(/\.\.(\/|\\|$)/g, "");
  const target = safe === "" ? "index.html" : safe;
  try {
    const data = await readFile(fileURLToPath(new URL(target, PUBLIC_DIR)));
    res.setHeader("content-type", STATIC_TYPES[extname(target)] ?? "application/octet-stream");
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const url = `http://${req.headers.host ?? `localhost:${PORT}`}${req.url ?? "/"}`;
  const method = req.method ?? "GET";

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    body = Buffer.concat(chunks);
  }

  return new Request(url, {
    method,
    headers,
    body: body && body.length > 0 ? body : undefined,
  });
}

async function writeWebResponse(res: ServerResponse, webRes: Response): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => res.setHeader(key, value));

  if (!webRes.body) {
    res.end();
    return;
  }

  const reader = webRes.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

const server = createServer((req, res) => {
  const pathname = (req.url ?? "/").split("?")[0] ?? "/";

  if (HEALTH_PATHS.has(pathname)) {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION, configured: isConfigured() }),
    );
    return;
  }

  if (!MCP_PATHS.has(pathname)) {
    void (async () => {
      if (req.method === "GET" && (await serveStatic(res, pathname))) return;
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Not found. MCP endpoint is POST /mcp." }));
    })();
    return;
  }

  void (async () => {
    try {
      const webReq = await toWebRequest(req);
      const webRes = await mcpHandler(webReq);
      await writeWebResponse(res, webRes);
    } catch (err) {
      logger.error("dev server failed to handle request", {
        message: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
      }
      res.end(JSON.stringify({ error: "Internal server error." }));
    }
  })();
});

server.listen(PORT, () => {
  logger.info("domain-checker-mcp dev server listening", {
    url: `http://localhost:${PORT}/mcp`,
    health: `http://localhost:${PORT}/health`,
    configured: isConfigured(),
  });
});
