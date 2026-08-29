/**
 * Vercel Function — remote MCP endpoint.
 *
 * Deployed URL:  https://<your-project>.vercel.app/mcp
 * (also reachable at /api/mcp; `vercel.json` rewrites every path here)
 *
 * Uses the web-standard handler signature supported by the Vercel Node.js
 * runtime (`GET | POST | DELETE (request: Request) => Response`).
 *
 * The MCP transport is stateless Streamable HTTP (mcp-handler v2): no session
 * state is kept between invocations, which is the correct model for serverless.
 */

import { mcpHandler } from "../src/server.js";

function handler(request: Request): Promise<Response> {
  return mcpHandler(request);
}

export { handler as GET, handler as POST, handler as DELETE };
