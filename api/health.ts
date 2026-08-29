/**
 * Vercel Function — lightweight health check.
 *
 * GET https://<your-project>.vercel.app/api/health   (also /health via rewrite)
 *
 * Reports whether a RapidAPI key is configured, but NEVER its value.
 */

import { isConfigured } from "../src/config.js";
import { SERVER_NAME, SERVER_VERSION } from "../src/server.js";

function handler(): Response {
  return new Response(
    JSON.stringify({
      status: "ok",
      server: SERVER_NAME,
      version: SERVER_VERSION,
      configured: isConfigured(),
    }),
    { headers: { "content-type": "application/json" } },
  );
}

export { handler as GET };
