# Domain Checker MCP

A production-ready **remote MCP (Model Context Protocol) server** that lets AI assistants
such as **Claude** check whether a domain name is available for registration — powered by
the [RapidAPI **Domain Status**](https://rapidapi.com/) API.

> _"Check whether mybrand.ai is available."_
> → Claude calls the `check_domain_availability` tool → clean, structured answer.

- **Transport:** stateless **Streamable HTTP** (MCP spec `2026-07-28`, `mcp-handler` v2 / MCP SDK v2)
- **Deploy target:** Vercel serverless (also runs locally over stdio)
- **One tool:** `check_domain_availability`

---

## Live instance

A hosted instance is running here:

| | |
| --- | --- |
| **MCP endpoint** | `https://domain-checker-mcp.vercel.app/mcp` |
| **Landing page** | <https://domain-checker-mcp.vercel.app> |
| **Health** | <https://domain-checker-mcp.vercel.app/health> |

Add that endpoint URL to Claude ([step by step below](#use-it-in-claude--step-by-step)) and start
asking. It shares one free RapidAPI key across everyone, so it is rate-limited and may
return "rate limiting" messages under load — for anything real,
[run your own copy](#run-your-own-copy-recommended) (free, ~3 minutes).

---

## Table of contents

1. [What it does](#what-it-does)
2. [Use it in Claude — step by step](#use-it-in-claude--step-by-step)
3. [Run your own copy (recommended)](#run-your-own-copy-recommended)
4. [Local development](#local-development)
5. [Architecture & project layout](#architecture--project-layout)
6. [The MCP tool](#the-mcp-tool)
7. [Configuration](#configuration)
8. [Error handling](#error-handling)
9. [Security & abuse protection](#security--abuse-protection)
10. [Notes for hosting a public shared instance](#notes-for-hosting-a-public-shared-instance)

---

## What it does

| | |
| --- | --- |
| **Tool** | `check_domain_availability` |
| **Input** | `{ "name": "mybrand", "tld": "ai" }` (both required strings) |
| **Output** | Readable text + `structuredContent` (`available`, `tldValid`, `checkMethod`, …) |

Input is normalised before the upstream call: trimmed, lower-cased, a leading dot on the
TLD is removed (`.AI` → `ai`), a redundant TLD in the name is de-duplicated
(`mybrand.ai` + `ai` → `mybrand`), and full URLs / invalid characters are
rejected with a safe message.

---

## Use it in Claude — step by step

> Examples below use the [live instance](#live-instance)
> (`https://domain-checker-mcp.vercel.app/mcp`). If you deployed your own, swap in
> `https://<your-project>.vercel.app/mcp`.

### A. Claude.ai (web) or Claude Desktop — custom connector

1. Open **Claude** → click your name / avatar → **Settings**.
2. Go to **Connectors** (on some plans: **Feature preview → Model Context Protocol**).
3. Click **Add custom connector** (or **Add connector → Custom**).
4. Fill in:
   - **Name:** `Domain Checker`
   - **URL:** `https://domain-checker-mcp.vercel.app/mcp`   ← note the `/mcp` path
5. Click **Add** / **Save**. The connector needs no authentication.
6. Open a chat. Click the **connectors / tools** button (🔌 or the slider icon near the
   prompt box) and make sure **Domain Checker** is enabled for the conversation.
7. Ask a question (see [prompts to try](#prompts-to-try)). The first time, Claude will ask
   permission to use the tool — click **Allow**.

> **Requirements:** custom/remote MCP connectors are available on Claude Pro, Max, Team,
> and Enterprise. On a free plan you can still use it locally over stdio (see
> [Local: Claude Desktop over stdio](#c-local-claude-desktop-over-stdio)).

### B. Claude Code (CLI)

```bash
claude mcp add --transport http domain-checker https://domain-checker-mcp.vercel.app/mcp
```

Verify:

```bash
claude mcp list
# domain-checker   http   https://domain-checker-mcp.vercel.app/mcp   ✓ connected
```

Then in a Claude Code session just ask: *"Is mybrand.io available?"*
To remove it later: `claude mcp remove domain-checker`.

### C. Local: Claude Desktop over stdio

If you cloned the repo and want to run it locally (no hosting, works on any plan):

```bash
npm install
npm run build
```

Edit your **`claude_desktop_config.json`**
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`,
Windows: `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "domain-checker": {
      "command": "node",
      "args": ["/absolute/path/to/domain-checker-mcp/dist/index.js"],
      "env": { "RAPIDAPI_KEY": "your_rapidapi_key_here" }
    }
  }
}
```

Restart Claude Desktop. The tool appears under the 🔌 menu.

### D. Cursor / Windsurf / other MCP clients

Add to the client's MCP config (e.g. `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "domain-checker": { "url": "https://domain-checker-mcp.vercel.app/mcp" }
  }
}
```

### Prompts to try

```
Check mybrand.ai
Is mybrand.com available?
Check whether mybrand.io is available
Are any of these free: acme.dev, acme.io, acme.ai?
```

Claude should call `check_domain_availability` with, e.g.,
`{ "name": "mybrand", "tld": "ai" }` and report the status.

---

## Run your own copy (recommended)

The public repo is meant to be **cloned and self-hosted** — each person runs their own
instance with their own **free** RapidAPI key. That way nobody shares a rate limit or a
bill. Takes ~3 minutes.

### 1. Get a RapidAPI key

1. Sign up at [rapidapi.com](https://rapidapi.com/).
2. Open the **Domain Status** API and click **Subscribe to Test** (there is a free tier).
3. Copy your **`X-RapidAPI-Key`**.

### 2. Get the code

```bash
git clone https://github.com/LearnerSumit/domain-checker-mcp.git
cd domain-checker-mcp
npm install
```

(Or click **Fork** on GitHub first, then clone your fork.)

### 3. Deploy to Vercel

**Option A — Dashboard (easiest)**

1. Push your copy to GitHub (`git push`).
2. Go to <https://vercel.com/new> and **import** the repository.
3. Leave build settings as detected (the included `vercel.json` handles everything —
   no framework, no build command). Application Preset "Node" is fine.
4. Expand **Environment Variables**. Vercel pre-detects `RAPIDAPI_KEY` from
   `.env.example` **with the placeholder value** — replace it with your real key
   (leave it applied to all environments):

   | Name | Value |
   | --- | --- |
   | `RAPIDAPI_KEY` | _your RapidAPI key_ (not `your_rapidapi_key_here`) |

5. Click **Deploy**.
6. If you add or change the key *after* the first deploy, go to
   **Deployments → ⋯ → Redeploy** so it takes effect.

**Option B — Vercel CLI**

```bash
npm i -g vercel
vercel login
vercel link
vercel env add RAPIDAPI_KEY production      # paste key when prompted
vercel env add RAPIDAPI_KEY preview
vercel env add RAPIDAPI_KEY development
vercel --prod
```

### 4. Verify

```bash
curl https://your-project.vercel.app/health
# {"status":"ok","server":"domain-checker-mcp","version":"1.0.0","configured":true}

curl -s -X POST https://your-project.vercel.app/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Visiting `https://your-project.vercel.app/` in a browser shows a small landing page with
the endpoint and connect instructions.

### 5. Connect it to Claude

Use the URL `https://your-project.vercel.app/mcp` and follow
[Use it in Claude](#use-it-in-claude--step-by-step).

---

## Local development

```bash
cp .env.example .env        # then set RAPIDAPI_KEY in .env
npm run dev                 # HTTP dev server → http://localhost:3000/mcp  (+ /health, + landing page)
npm run dev:stdio           # stdio transport with hot reload
npm run typecheck           # tsc --noEmit
npm test                    # Vitest (external API mocked — no key or network needed)
npm run build               # compile src/ → dist/
npm start                   # run the compiled stdio server (dist/index.js)
npm run inspect             # open the MCP Inspector
```

Test the running dev server with the Inspector (**Streamable HTTP**, URL
`http://localhost:3000/mcp`) or curl:

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check_domain_availability","arguments":{"name":"mybrand","tld":"ai"}}}'
```

---

## Architecture & project layout

```
Claude ──HTTPS──▶ Vercel Function (api/mcp.ts)
                       │
                       ▼
                 mcp-handler  (Streamable HTTP, stateless)
                       │
                       ▼
        check_domain_availability tool  (src/tools/domain.ts)
              │                    │
              ▼                    ▼
   per-client rate limit    validation/domain.ts   ──▶  services/rapidapi.ts
   (src/utils/rateLimit)    (normalise + validate)      (the only outbound call:
                                                         timeout + error mapping)
                                                              │
                                                              ▼
                        POST https://domainstatus.p.rapidapi.com/v1/domain/available
```

| Path | Purpose |
| --- | --- |
| `api/mcp.ts` | Vercel Function — the remote MCP endpoint (`GET`/`POST`/`DELETE`) |
| `api/health.ts` | Vercel Function — `GET /health` |
| `public/index.html` | Landing page served at `/` |
| `src/server.ts` | Builds the `mcp-handler` handler; registers capabilities |
| `src/index.ts` | Local **stdio** entrypoint (`npm start`) |
| `src/dev.ts` | Local **HTTP** dev server — same handler as Vercel |
| `src/tools/domain.ts` | The `check_domain_availability` tool (rate limit + thin handler + formatter) |
| `src/services/rapidapi.ts` | The **only** module that calls RapidAPI |
| `src/validation/domain.ts` | Input normalisation & validation |
| `src/types/domain.ts` | RapidAPI response schema + clean result types |
| `src/config.ts` | Env-var configuration |
| `src/utils/rateLimit.ts` | In-memory per-client rate limiter |
| `src/utils/errors.ts` | `AppError` taxonomy + secret redaction |
| `src/utils/logger.ts` | Minimal structured logger (stderr, redacts secrets) |
| `src/utils/env.ts` | Loads `.env` locally (no-op on Vercel) |
| `tests/` | Vitest unit tests (external API mocked) |

---

## The MCP tool

**Name:** `check_domain_availability`

**Input schema** — both fields required strings:

```json
{ "name": "mybrand", "tld": "ai" }
```

| Input | Behaviour |
| --- | --- |
| `{ "name": " MyBrand ", "tld": ".AI" }` | → `{ "name": "mybrand", "tld": "ai" }` |
| `{ "name": "mybrand.ai", "tld": "ai" }` | → `{ "name": "mybrand", "tld": "ai" }` |
| `{ "name": "https://mybrand.ai", "tld": "ai" }` | ❌ rejected — _"…not a URL"_ |
| `{ "name": "hello world", "tld": "com" }` | ❌ rejected — _"Invalid domain name."_ |
| any TLD (`com`, `ai`, `io`, `co`, `dev`, `co.uk`, …) | ✅ generic validation, nothing hard-coded |

**Result:**

```
Domain: mybrand.ai
Status: AVAILABLE
TLD Valid: Yes
Check Method: WHOIS
Lookup Time: 918ms
```

```jsonc
{
  "domain": "mybrand.ai",
  "name": "mybrand",
  "tld": "ai",
  "available": true,
  "tldValid": true,
  "checkMethod": "whois",
  "elapsed": "918ms"
}
```

---

## Configuration

All via environment variables (`.env` locally, project settings on Vercel):

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `RAPIDAPI_KEY` | ✅ | – | Your RapidAPI key. Never commit it. |
| `RAPIDAPI_TIMEOUT_MS` | | `10000` | Upstream request timeout (clamped 1 000–60 000). |
| `RAPIDAPI_HOST` | | `domainstatus.p.rapidapi.com` | Rarely changed. |
| `RATE_LIMIT_MAX` | | `15` | Tool calls per client per window. `0` disables. |
| `RATE_LIMIT_WINDOW_MS` | | `60000` | Rate-limit window length. |
| `LOG_LEVEL` | | `info` | `debug` \| `info` \| `warn` \| `error` \| `silent` |
| `PORT` | | `3000` | Local HTTP dev server only. |

---

## Error handling

Every failure becomes a safe tool result with `isError: true` — never a stack trace,
never a secret, never a raw upstream body.

| Situation | HTTP | Message |
| --- | --- | --- |
| `RAPIDAPI_KEY` missing | – | `RAPIDAPI_KEY is not configured.` |
| Invalid input | – | `Invalid domain name. …` / `Invalid TLD. …` |
| Auth failure | 401 / 403 | `…rejected the API credentials. …` |
| Rate limited (upstream) | 429 | `…is rate limiting requests. …` |
| Rate limited (this server) | – | `Rate limit reached for this client. Please wait Ns…` |
| Upstream down | 5xx | `…is temporarily unavailable. …` |
| Timeout | – | `…request timed out. …` |
| Malformed / unexpected body | – | `…returned data in an unexpected format.` |

---

## Security & abuse protection

- ✅ API key read only from `process.env.RAPIDAPI_KEY` — never hard-coded
- ✅ `.env` is git-ignored; `.env.example` holds only a placeholder
- ✅ API key never returned to the client, never logged (logger redacts it and any
  `key`/`secret`/`token`/`authorization` field), never in an error message
- ✅ Input validated & normalised; full URLs and bad characters rejected
- ✅ No user-controlled URLs — only the single hard-coded RapidAPI endpoint is called
  (no SSRF surface)
- ✅ Request timeout via `AbortController` (default 10 s, capped)
- ✅ Per-client (per-IP) rate limiting on tool calls
- ✅ Stateless transport — no session data persisted

---

## Notes for hosting a public shared instance

If you deploy **one** instance and share the URL publicly (e.g. on Reddit) so strangers
connect their Claude to it:

- **One RapidAPI key serves everyone.** All lookups count against *your* quota and *your*
  bill. The free Domain Status tier is very small (expect frequent `429`s under load).
  Move to a paid RapidAPI plan, or ask people to self-host.
- **Keep `RATE_LIMIT_MAX` sane** (default 15/min/IP). It is per-serverless-instance, so it
  caps a single abuser but is not a strict global limit. For hard limits put
  [Vercel Firewall](https://vercel.com/docs/vercel-firewall) or a KV-backed limiter in front.
- **Rotate the key if it ever leaks** (screenshots, commits, logs): regenerate it in the
  RapidAPI dashboard and update only the Vercel env var.
- **There is no auth on the tool** by design (so "anyone can use it"). If you want to
  restrict access, `mcp-handler` ships `withMcpAuth` — wrap the handler in `src/server.ts`.
- The safest public model is **share the repo, not the endpoint** — point people at
  [Run your own copy](#run-your-own-copy-recommended).

---

## Tech stack

Node.js 20+ · TypeScript (strict) · `@modelcontextprotocol/server` v2 · `mcp-handler` v2
(Streamable HTTP) · `zod` v4 · native `fetch` · Vitest · Vercel.

## Author

**Sumit Kumar**
· [GitHub](https://github.com/LearnerSumit)
· [LinkedIn](https://www.linkedin.com/in/sumitkumar7761/)
· [sumitdbg255@gmail.com](mailto:sumitdbg255@gmail.com)

If this saved you some time, a ⭐ on the
[repo](https://github.com/LearnerSumit/domain-checker-mcp) is appreciated.

## License

[MIT](LICENSE)
