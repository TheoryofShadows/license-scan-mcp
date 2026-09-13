# @mcpx-digital/license-scan

**MCP server for dependency license awareness (advisory).**

Scan `package.json` + lockfiles for dependency licenses. When the lockfile has no license field, optionally read the **license** metadata from the public npm registry (no tarball downloads). Flag GPL/AGPL/unknown licenses for commercial awareness.

> **ADVISORY ONLY — not legal advice.** Metadata can be wrong or incomplete. Verify critical dependencies yourself before shipping.

## Install

```bash
npx -y @mcpx-digital/license-scan
```

## Cursor `mcp.json` example

```json
{
  "mcpServers": {
    "license-scan": {
      "command": "npx",
      "args": ["-y", "@mcpx-digital/license-scan"]
    }
  }
}
```

Local clone:

```json
{
  "mcpServers": {
    "license-scan": {
      "command": "node",
      "args": ["/absolute/path/to/license-scan-mcp/index.js"]
    }
  }
}
```

## Tools

| Tool | What it does |
|------|----------------|
| `scan_licenses` | Full scan of deps with classifications |
| `flag_risky_licenses` | GPL/AGPL/LGPL-family + unknown only |
| `classify_license_string` | Classify one license string |

## Example prompts

- “Scan licenses in `/path/to/my-app`”
- “Flag copyleft/unknown licenses for this project”
- “Is `GPL-3.0-or-later` copyleft?”

## Development

```bash
git clone https://github.com/TheoryofShadows/license-scan-mcp.git
cd license-scan-mcp
npm install
npm test
```

## License

MIT
