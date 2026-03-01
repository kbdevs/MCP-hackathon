import { readdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const server = new Server(
  {
    name: "dedalus-developer-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const MAX_FILE_BYTES = 250_000;
const DEFAULT_EXCLUDES = new Set([".git", "node_modules", "dist", ".next", "coverage"]);

const projectInsightsSchema = z
  .object({
    rootPath: z.string().default("."),
    maxDepth: z.number().int().min(1).max(6).default(3),
  })
  .strict();

const searchCodeSchema = z
  .object({
    rootPath: z.string().default("."),
    query: z.string().min(1),
    fileExtensions: z.array(z.string()).optional(),
    maxResults: z.number().int().min(1).max(200).default(40),
    caseSensitive: z.boolean().default(false),
  })
  .strict();

const featurePlanSchema = z
  .object({
    feature: z.string().min(3),
    stack: z.string().default("TypeScript + Bun"),
    constraints: z.array(z.string()).default([]),
  })
  .strict();

const dedalusContextSchema = z
  .object({
    url: z.string().url().default("https://www.dedaluslabs.ai/"),
  })
  .strict();

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "project_insights",
        description:
          "Inspect repository structure and key files for onboarding and planning.",
        inputSchema: {
          type: "object",
          properties: {
            rootPath: { type: "string", description: "Repository root path." },
            maxDepth: { type: "number", description: "Tree depth (1-6)." },
          },
        },
      },
      {
        name: "search_code",
        description:
          "Search code with plain text query across files with optional extension filtering.",
        inputSchema: {
          type: "object",
          properties: {
            rootPath: { type: "string" },
            query: { type: "string" },
            fileExtensions: {
              type: "array",
              items: { type: "string" },
              description: "Example: ['ts', 'tsx', 'md']",
            },
            maxResults: { type: "number" },
            caseSensitive: { type: "boolean" },
          },
          required: ["query"],
        },
      },
      {
        name: "generate_feature_plan",
        description:
          "Generate an implementation checklist and risks for a requested feature.",
        inputSchema: {
          type: "object",
          properties: {
            feature: { type: "string" },
            stack: { type: "string" },
            constraints: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["feature"],
        },
      },
      {
        name: "fetch_dedalus_context",
        description:
          "Fetch and summarize title, metadata, and first links from dedaluslabs.ai.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string" },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  try {
    const { name, arguments: args } = request.params;

    if (name === "project_insights") {
      const parsed = projectInsightsSchema.parse(args ?? {});
      const rootPath = path.resolve(parsed.rootPath);
      const tree = await buildTree(rootPath, parsed.maxDepth);
      const highlights = await collectHighlights(rootPath);
      return textResponse([
        `Root: ${rootPath}`,
        "",
        "Tree:",
        tree,
        "",
        "Highlights:",
        ...highlights,
      ].join("\n"));
    }

    if (name === "search_code") {
      const parsed = searchCodeSchema.parse(args ?? {});
      const rootPath = path.resolve(parsed.rootPath);
      const results = await searchCode(
        rootPath,
        parsed.query,
        parsed.maxResults,
        parsed.caseSensitive,
        parsed.fileExtensions
      );

      if (results.length === 0) {
        return textResponse("No matches found.");
      }

      return textResponse(results.join("\n"));
    }

    if (name === "generate_feature_plan") {
      const parsed = featurePlanSchema.parse(args ?? {});
      const plan = generateFeaturePlan(parsed.feature, parsed.stack, parsed.constraints);
      return textResponse(plan);
    }

    if (name === "fetch_dedalus_context") {
      const parsed = dedalusContextSchema.parse(args ?? {});
      const output = await fetchDedalusContext(parsed.url);
      return textResponse(output);
    }

    return textResponse(`Unknown tool: ${name}`, true);
  } catch (error) {
    return textResponse(
      error instanceof Error ? `Tool execution failed: ${error.message}` : "Tool execution failed.",
      true
    );
  }
});

function textResponse(text: string, isError = false) {
  return {
    content: [{ type: "text", text }],
    isError,
  };
}

async function buildTree(dirPath: string, maxDepth: number, depth = 0): Promise<string> {
  if (depth >= maxDepth) {
    return "";
  }

  const entries = await readdir(dirPath, { withFileTypes: true });
  const lines: string[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (DEFAULT_EXCLUDES.has(entry.name)) {
      continue;
    }

    const prefix = "  ".repeat(depth);
    const full = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      lines.push(`${prefix}- ${entry.name}/`);
      const nested = await buildTree(full, maxDepth, depth + 1);
      if (nested.trim().length > 0) {
        lines.push(nested);
      }
      continue;
    }

    lines.push(`${prefix}- ${entry.name}`);
  }

  return lines.join("\n");
}

async function collectHighlights(rootPath: string): Promise<string[]> {
  const candidateFiles = ["README.md", "package.json", "tsconfig.json", "pyproject.toml", "Cargo.toml"];
  const highlights: string[] = [];

  for (const fileName of candidateFiles) {
    const fullPath = path.join(rootPath, fileName);
    try {
      const fileStat = await stat(fullPath);
      if (!fileStat.isFile()) {
        continue;
      }

      if (fileName === "package.json") {
        const raw = await readFile(fullPath, "utf8");
        const parsed = JSON.parse(raw) as { name?: string; scripts?: Record<string, string> };
        const scriptNames = Object.keys(parsed.scripts ?? {});
        highlights.push(`- package: ${parsed.name ?? "(unnamed)"}`);
        highlights.push(`- scripts: ${scriptNames.length > 0 ? scriptNames.join(", ") : "none"}`);
        continue;
      }

      const snippet = (await readFile(fullPath, "utf8")).split("\n").slice(0, 5).join(" ").trim();
      highlights.push(`- ${fileName}: ${snippet.slice(0, 180)}`);
    } catch {
      // skip missing files
    }
  }

  if (highlights.length === 0) {
    highlights.push("- No standard metadata files found.");
  }

  return highlights;
}

async function searchCode(
  rootPath: string,
  query: string,
  maxResults: number,
  caseSensitive: boolean,
  fileExtensions?: string[]
): Promise<string[]> {
  const normalizedExtensions = (fileExtensions ?? []).map((ext) => ext.replace(/^\./, "").toLowerCase());
  const results: string[] = [];
  const stack = [rootPath];
  const queryToUse = caseSensitive ? query : query.toLowerCase();

  while (stack.length > 0 && results.length < maxResults) {
    const current = stack.pop();
    if (!current) {
      break;
    }

    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (DEFAULT_EXCLUDES.has(entry.name) || results.length >= maxResults) {
        continue;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (normalizedExtensions.length > 0) {
        const ext = path.extname(entry.name).replace(/^\./, "").toLowerCase();
        if (!normalizedExtensions.includes(ext)) {
          continue;
        }
      }

      const fileStat = await stat(fullPath);
      if (fileStat.size > MAX_FILE_BYTES) {
        continue;
      }

      let content: string;
      try {
        content = await readFile(fullPath, "utf8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      for (let i = 0; i < lines.length && results.length < maxResults; i += 1) {
        const line = caseSensitive ? lines[i] : lines[i].toLowerCase();
        if (line.includes(queryToUse)) {
          const displayPath = path.relative(rootPath, fullPath) || fullPath;
          results.push(`${displayPath}:${i + 1} ${lines[i].trim()}`);
        }
      }
    }
  }

  return results;
}

function generateFeaturePlan(feature: string, stack: string, constraints: string[]): string {
  const normalizedConstraints = constraints.length > 0 ? constraints : ["Ship an MVP in under 1 day"];

  return [
    `Feature: ${feature}`,
    `Stack: ${stack}`,
    "",
    "Implementation Checklist:",
    "1. Clarify user story and acceptance criteria.",
    "2. Sketch architecture changes and data flow.",
    "3. Implement backend or integration layer.",
    "4. Implement client or interface updates.",
    "5. Add tests and telemetry for critical paths.",
    "6. Validate against performance, security, and DX goals.",
    "",
    "Constraints:",
    ...normalizedConstraints.map((item) => `- ${item}`),
    "",
    "Risks & Mitigations:",
    "- Scope creep -> Freeze MVP before coding.",
    "- Integration instability -> Mock external dependencies first.",
    "- Regression risk -> Add minimal end-to-end happy-path test.",
  ].join("\n");
}

async function fetchDedalusContext(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "dedalus-developer-mcp/0.1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  const html = await response.text();
  const title = html.match(/<title>(.*?)<\/title>/i)?.[1]?.trim() ?? "(no title found)";
  const description =
    html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1]?.trim() ??
    "(no meta description found)";

  const links = Array.from(html.matchAll(/<a\s+[^>]*href=["']([^"']+)["']/gi))
    .map((match) => match[1])
    .filter((link) => link.startsWith("http") || link.startsWith("/"))
    .slice(0, 12);

  return [
    `URL: ${url}`,
    `Title: ${title}`,
    `Description: ${description}`,
    "Links:",
    ...links.map((link) => `- ${link}`),
  ].join("\n");
}

async function startStdioServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttpServer(): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  const host = process.env.HOST ?? "0.0.0.0";
  const port = Number(process.env.PORT ?? "3000");

  const httpServer = createServer(async (req, res) => {
    const base = `http://${req.headers.host ?? `${host}:${port}`}`;
    const url = new URL(req.url ?? "/", base);

    if (url.pathname === "/" || url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, name: "dedalus-developer-mcp" }));
      return;
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    if (!["GET", "POST", "DELETE"].includes(req.method ?? "")) {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Request handling failed",
        })
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      process.stderr.write(`MCP server listening on http://${host}:${port}/mcp\n`);
      resolve();
    });
  });
}

const transportMode = process.env.MCP_TRANSPORT ?? (process.env.PORT ? "http" : "stdio");

if (transportMode === "http") {
  await startHttpServer();
} else {
  await startStdioServer();
}
