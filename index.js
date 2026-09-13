#!/usr/bin/env node
/**
 * @mcpx-digital/license-scan — MCP server for dependency license awareness.
 * Advisory only — not legal advice. Transport: stdio.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { scanLicenses, flagRiskyLicenses, classifyLicense } from "./lib.js";

const ADVISORY =
  "ADVISORY ONLY — not legal advice. Uses lockfile metadata and/or the public npm registry license field (no tarball downloads).";

const TOOLS = [
  {
    name: "scan_licenses",
    description: `Scan package.json (+ lockfile) for dependency licenses; optionally fill gaps via npm registry license field. ${ADVISORY}`,
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to project directory containing package.json." },
        includeDev: { type: "boolean", description: "Include devDependencies (default true)." },
        includePeer: { type: "boolean", description: "Include peerDependencies (default false)." },
        fetchMissing: {
          type: "boolean",
          description: "Query npm registry for deps missing license in lockfile (default true).",
        },
        maxFetch: { type: "number", description: "Max registry lookups (default 80, max 200)." },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "flag_risky_licenses",
    description: `Flag GPL/AGPL/LGPL-family and unknown licenses for commercial awareness. ${ADVISORY}`,
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to project directory containing package.json." },
        includeDev: { type: "boolean", description: "Include devDependencies (default true)." },
        fetchMissing: { type: "boolean", description: "Query npm registry for missing licenses (default true)." },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "classify_license_string",
    description: `Classify a single license string as permissive / copyleft / unknown / other. ${ADVISORY}`,
    inputSchema: {
      type: "object",
      properties: {
        license: { type: "string", description: "License string (e.g. MIT, Apache-2.0, GPL-3.0)." },
      },
      required: ["license"],
    },
  },
];

const handlers = {
  scan_licenses: scanLicenses,
  flag_risky_licenses: flagRiskyLicenses,
  classify_license_string: async (args) => ({
    license: args.license,
    ...classifyLicense(args.license),
    disclaimer: ADVISORY,
  }),
};

const server = new Server(
  { name: "license-scan", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments ?? {};
  const handler = handlers[name];
  if (!handler) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    const result = await handler(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
