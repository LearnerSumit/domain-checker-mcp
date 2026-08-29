/**
 * MCP server definition.
 *
 * `mcpHandler` is a web-standard `(Request) => Promise<Response>` produced by
 * `mcp-handler` v2. It speaks the 2026-07-28 MCP spec over **stateless
 * Streamable HTTP**, with a transparent fallback for 2025-era Streamable HTTP
 * clients. It is transport-agnostic and framework-agnostic, so the same handler
 * is mounted by the Vercel function (`api/mcp.ts`) and the local dev server
 * (`src/dev.ts`).
 */

import { createMcpHandler } from "mcp-handler";
import type { McpServer } from "@modelcontextprotocol/server";

import { registerCheckDomainAvailability } from "./tools/domain.js";

export const SERVER_NAME = "domain-checker-mcp";
export const SERVER_VERSION = "1.0.0";

/** Registers every tool/prompt/resource on a server instance. */
export function registerCapabilities(server: McpServer): void {
  registerCheckDomainAvailability(server);
}

export const mcpHandler: (request: Request) => Promise<Response> = createMcpHandler(
  (server) => {
    registerCapabilities(server);
  },
  {
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    instructions:
      "Use the check_domain_availability tool to determine whether a domain name is " +
      "available for registration. Pass the second-level name and the TLD separately.",
  },
);
