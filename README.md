# Dedalus Developer MCP Server

A Bun + TypeScript MCP server tailored for hackathon developer workflows.

## What this server provides

- `project_insights`: quick repo tree + metadata snapshot.
- `search_code`: text search across source files.
- `generate_feature_plan`: implementation plan scaffold with risks.
- `fetch_dedalus_context`: fetch and summarize key context from `dedaluslabs.ai` pages.

## Quick start

```bash
bun install
bun run check
bun run start
```

The server uses stdio transport and is ready to be attached in any MCP-compatible client.

## Example MCP client config

```json
{
  "mcpServers": {
    "dedalus-developer": {
      "command": "bun",
      "args": ["run", "src/index.ts"],
      "cwd": "/absolute/path/to/dedalus-developer-mcp-server"
    }
  }
}
```

## Notes

- This implementation avoids external API keys.
- Keep repository root scoped to trusted codebases when calling tools.
