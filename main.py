from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dedalus_mcp import MCPServer, tool

MAX_FILE_BYTES = 250_000
DEFAULT_EXCLUDES = {".git", "node_modules", "dist", ".next", "coverage", ".venv", "__pycache__"}


@tool(description="Inspect repository structure and key files for onboarding and planning.")
def project_insights(root_path: str = ".", max_depth: int = 3) -> str:
    max_depth = max(1, min(max_depth, 6))
    root = Path(root_path).resolve()
    tree = build_tree(root, max_depth)
    highlights = collect_highlights(root)

    return "\n".join(
        [
            f"Root: {root}",
            "",
            "Tree:",
            tree,
            "",
            "Highlights:",
            *highlights,
        ]
    )


@tool(description="Search code with plain text query across files with optional extension filtering.")
def search_code(
    query: str,
    root_path: str = ".",
    file_extensions: list[str] | None = None,
    max_results: int = 40,
    case_sensitive: bool = False,
) -> str:
    root = Path(root_path).resolve()
    max_results = max(1, min(max_results, 200))
    normalized_ext = {(ext[1:] if ext.startswith(".") else ext).lower() for ext in (file_extensions or [])}

    needle = query if case_sensitive else query.lower()
    results: list[str] = []

    for file_path in iter_files(root):
        if len(results) >= max_results:
            break

        if normalized_ext:
            suffix = file_path.suffix[1:].lower() if file_path.suffix else ""
            if suffix not in normalized_ext:
                continue

        try:
            if file_path.stat().st_size > MAX_FILE_BYTES:
                continue
            content = file_path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        for index, line in enumerate(content.splitlines(), start=1):
            if len(results) >= max_results:
                break
            haystack = line if case_sensitive else line.lower()
            if needle in haystack:
                display_path = file_path.relative_to(root)
                results.append(f"{display_path}:{index} {line.strip()}")

    return "\n".join(results) if results else "No matches found."


@tool(description="Generate an implementation checklist and risks for a requested feature.")
def generate_feature_plan(
    feature: str,
    stack: str = "Python + dedalus_mcp",
    constraints: list[str] | None = None,
) -> str:
    constraints = constraints or ["Ship an MVP in under 1 day"]

    return "\n".join(
        [
            f"Feature: {feature}",
            f"Stack: {stack}",
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
            *[f"- {item}" for item in constraints],
            "",
            "Risks & Mitigations:",
            "- Scope creep -> Freeze MVP before coding.",
            "- Integration instability -> Mock external dependencies first.",
            "- Regression risk -> Add minimal end-to-end happy-path test.",
        ]
    )


@tool(description="Fetch and summarize title, metadata, and first links from dedaluslabs.ai.")
def fetch_dedalus_context(url: str = "https://www.dedaluslabs.ai/") -> str:
    request = Request(url, headers={"user-agent": "dedalus-developer-mcp/0.2.0"})
    try:
        with urlopen(request, timeout=20) as response:
            html = response.read().decode("utf-8", errors="ignore")
    except HTTPError as error:
        raise ValueError(f"Failed to fetch {url}: HTTP {error.code}") from error
    except URLError as error:
        raise ValueError(f"Failed to fetch {url}: {error.reason}") from error

    title = match_tag(html, "title") or "(no title found)"
    description = match_meta_description(html) or "(no meta description found)"
    links = extract_links(html)[:12]

    return "\n".join(
        [
            f"URL: {url}",
            f"Title: {title}",
            f"Description: {description}",
            "Links:",
            *[f"- {item}" for item in links],
        ]
    )


def build_tree(root: Path, max_depth: int, depth: int = 0) -> str:
    if depth >= max_depth or not root.exists() or not root.is_dir():
        return ""

    lines: list[str] = []
    for child in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if child.name in DEFAULT_EXCLUDES:
            continue

        prefix = "  " * depth
        if child.is_dir():
            lines.append(f"{prefix}- {child.name}/")
            nested = build_tree(child, max_depth, depth + 1)
            if nested.strip():
                lines.append(nested)
        else:
            lines.append(f"{prefix}- {child.name}")

    return "\n".join(lines)


def collect_highlights(root: Path) -> list[str]:
    files = ["README.md", "package.json", "tsconfig.json", "pyproject.toml", "Cargo.toml"]
    highlights: list[str] = []

    for name in files:
        path = root / name
        if not path.exists() or not path.is_file():
            continue

        if name == "package.json":
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue

            package_name = data.get("name", "(unnamed)")
            scripts = data.get("scripts", {})
            script_names = ", ".join(scripts.keys()) if scripts else "none"
            highlights.append(f"- package: {package_name}")
            highlights.append(f"- scripts: {script_names}")
            continue

        try:
            snippet = " ".join(path.read_text(encoding="utf-8").splitlines()[:5]).strip()
        except OSError:
            continue
        highlights.append(f"- {name}: {snippet[:180]}")

    return highlights or ["- No standard metadata files found."]


def iter_files(root: Path):
    if not root.exists():
        return
    stack = [root]
    while stack:
        current = stack.pop()
        if current.name in DEFAULT_EXCLUDES:
            continue
        if current.is_dir():
            for child in sorted(current.iterdir(), key=lambda p: p.name.lower(), reverse=True):
                stack.append(child)
            continue
        if current.is_file():
            yield current


def match_tag(html: str, tag: str) -> str | None:
    lower = html.lower()
    open_tag = f"<{tag}>"
    close_tag = f"</{tag}>"
    start = lower.find(open_tag)
    if start == -1:
        return None
    start += len(open_tag)
    end = lower.find(close_tag, start)
    if end == -1:
        return None
    return html[start:end].strip()


def match_meta_description(html: str) -> str | None:
    lower = html.lower()
    marker = 'name="description"'
    pos = lower.find(marker)
    if pos == -1:
        marker = "name='description'"
        pos = lower.find(marker)
    if pos == -1:
        return None

    content_marker = "content="
    content_pos = lower.find(content_marker, pos)
    if content_pos == -1:
        return None
    quote = html[content_pos + len(content_marker)]
    if quote not in {'"', "'"}:
        return None
    value_start = content_pos + len(content_marker) + 1
    value_end = html.find(quote, value_start)
    if value_end == -1:
        return None
    return html[value_start:value_end].strip()


def extract_links(html: str) -> list[str]:
    links: list[str] = []
    cursor = 0
    while True:
        idx = html.find("href=", cursor)
        if idx == -1:
            break
        quote = html[idx + 5 : idx + 6]
        if quote not in {'"', "'"}:
            cursor = idx + 5
            continue
        start = idx + 6
        end = html.find(quote, start)
        if end == -1:
            break
        href = html[start:end]
        if href.startswith("http") or href.startswith("/"):
            links.append(href)
        cursor = end + 1
    return links


server = MCPServer("MCP-hackathon")
server.collect(project_insights, search_code, generate_feature_plan, fetch_dedalus_context)


async def main() -> None:
    await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
