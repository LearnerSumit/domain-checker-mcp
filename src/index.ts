#!/usr/bin/env node
/**
 * Local stdio entrypoint.
 *
 * This is a convenience for running the server directly from a desktop MCP
 * client (Claude Desktop, MCP Inspector via stdio, ...). The primary,
 * production deployment target is the remote HTTP transport (`api/mcp.ts` on
 * Vercel) — see the README.
 */

import "./utils/env.js";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { registerCapabilities, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { logger } from "./utils/logger.js";

serveStdio(() => {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );
  registerCapabilities(server);
  return server;
});

logger.info("domain-checker-mcp stdio server started");
