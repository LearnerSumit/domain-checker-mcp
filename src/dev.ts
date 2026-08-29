/**
 * Local HTTP dev server.
 *
 * Wraps the web-standard `mcpHandler` in a Node `http` server so you can run
 * the remote MCP transport locally without the Vercel CLI:
 *
 *   npm run dev            # http://localhost:3000/mcp
 *
 * Routes:
 *   POST|GET|DELETE /mcp   -> MCP Streamable HTTP endpoint
 *   GET             /health -> { status: "ok" }
 *
 * This file is dev-only; on Vercel the same handler is mounted by `api/mcp.ts`.
 */

import "./utils/env.js";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { mcpHandler, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { isConfigured } from "./config.js";
import { logger } from "./utils/logger.js";

const LANDING_PAGE_PATH = fileURLToPath(new URL("../public/index.html", import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
const MCP_PATHS = new Set(["/mcp", "/api/mcp"]);
const HEALTH_PATHS = new Set(["/health", "/api/health"]);

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

  if (pathname === "/" || pathname === "/index.html") {
    void readFile(LANDING_PAGE_PATH, "utf8").then(
      (html) => {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(html);
      },
      () => {
        res.statusCode = 404;
        res.end("Not found");
      },
    );
    return;
  }

  if (HEALTH_PATHS.has(pathname)) {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION, configured: isConfigured() }),
    );
    return;
  }

  if (!MCP_PATHS.has(pathname)) {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Not found. MCP endpoint is POST /mcp." }));
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
