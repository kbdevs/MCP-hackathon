# Dedalus Developer MCP Server

A Python MCP server built with `dedalus_mcp` for Dedalus marketplace compatibility.

## What this server provides

- `project_insights`: quick repo tree + metadata snapshot.
- `search_code`: text search across source files.
- `generate_feature_plan`: implementation plan scaffold with risks.
- `fetch_dedalus_context`: fetch and summarize key context from `dedaluslabs.ai` pages.

## Quick start

```bash
uv sync
uv run python main.py
```

By default it serves MCP at `http://127.0.0.1:8000/mcp`.

## Example MCP client config

```json
{
  "mcpServers": {
    "dedalus-developer": {
      "command": "uv",
      "args": ["run", "python", "main.py"],
      "cwd": "/absolute/path/to/dedalus-developer-mcp-server"
    }
  }
}
```

## Notes

- This implementation uses Dedalus MCP protocol primitives directly (`dedalus_mcp.MCPServer`).
- Keep repository root scoped to trusted codebases when calling tools.
