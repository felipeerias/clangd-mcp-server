# Clangd MCP Server

[Model Context Protocol](https://modelcontextprotocol.io) server for clangd on large C++ codebases.

This MCP provides coding agents like Claude Code with a collection of tools that they may use to answer natural language queries from the user:

- `find_definition`: Jump to symbol definitions
  - _"Find the definition at src/foo.cpp:42:10"_
- `find_references`: Find all references to a symbol
  - _"Find all references to the function at bar.h:100"_
- `get_hover`: Get type information and documentation
  - _"What's the type at baz.cpp:200:15?"_
- `workspace_symbol_search`: Search symbols across workspace
  - _"Find symbols matching 'HttpRequest'"_
- `find_implementations`: Find interface/virtual method implementations
  - _"Find implementations of interface.h:50"_
- `get_document_symbols`: Get hierarchical symbol tree for a file
  - _"Show all symbols in main.cpp"_
- `get_diagnostics`: Get compiler errors, warnings, and notes
  - _"Show errors in src/foo.cpp"_
- `get_call_hierarchy`: Get function callers and callees
  - _"Show callers/callees at main.cpp:100:5"_
- `get_type_hierarchy`: Get base classes and derived classes
  - _"Show base/derived classes at foo.h:42"_
- `list_projects`: List the workspace's C++ projects and the `compile_commands.json` resolved for each
  - _"Which project does src/foo.cpp belong to?"_

## Multi-project workspaces

A workspace often holds several independent projects, each with its own
`compile_commands.json` and its own include paths and defines. You do not have to
point the server at one of them.

Every request is routed to the compilation database that owns the file, found by
walking up from the file's directory (checking `.`, `build/`, `out/Default`,
`out/Release`, `out/Debug` and `.build` at each level). One clangd instance is
started per database, on demand, so each project is analysed with its own
compile commands. Files outside every configured project still resolve through
the same ancestor search.

Declare the projects with `PROJECT_ROOTS`, or let the server read them from a VS
Code `.code-workspace` file via `WORKSPACE_FILE`. Use `list_projects` to see what
was resolved. Setting `COMPILE_COMMANDS_DIR` still forces a single database for
every file.

## Requirements

- Node.js >= 18.0.0
- clangd
- A C++ project with `compile_commands.json`

## Installation

```bash
# From npm (eventually!)
# npm install -g clangd-mcp-server

# From source
git clone https://github.com/felipeerias/clangd-mcp-server.git
cd clangd-mcp-server
npm install && npm run build && npm link
```

## Configuration

### Generating compile_commands.json

**CMake:** `cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON /path/to/source`

**GN (Chromium):** `gn gen out/Default`

```
gn gen --export-compile-commands out/default
ln -sf out/Default/compile_commands.json .
claude mcp add clangd-mcp-server clangd-mcp-server
```

**Other:** Check your project's documentation.

### Claude Code Configuration

```
claude mcp add clangd-mcp-server clangd-mcp-server
```

Or add manually to `~/.claude.json` or `.claude.json`:

```json
{
  "mcpServers": {
    "clangd": {
      "command": "clangd-mcp-server",
      "env": {"PROJECT_ROOT": "/path/to/your/project"},
      "alwaysAllow": ["*"]
    }
  }
}
```

The `alwaysAllow: ["*"]` field allows all tools to run without prompting for user approval.

### VS Code Configuration

Create `.vscode/mcp.json` in your workspace (or run **MCP: Add Server** from the
Command Palette). For a multi-root workspace, point `WORKSPACE_FILE` at the
`.code-workspace` file so every folder in it is picked up:

```json
{
  "servers": {
    "clangd": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/path/to/clangd-mcp-server/dist/index.js"],
      "env": {
        "WORKSPACE_FILE": "${workspaceFolder}/my.code-workspace",
        "CLANGD_PATH": "/path/to/clangd"
      }
    }
  }
}
```

VS Code asks you to trust the server the first time it starts. Use **MCP: List
Servers** to start, stop, or view its output.

### Project-Specific Configuration (CLAUDE.md)

To help Claude Code automatically use clangd MCP tools for your C++ project, add to your project's `CLAUDE.md`:

```markdown
## C++ Code Navigation

This project uses the clangd MCP server for C++ code intelligence. Use these tools for:
- Finding definitions and references
- Getting type information
- Searching symbols
- Finding implementations
- Getting diagnostics
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PROJECT_ROOT` | Primary project workspace root | Current directory |
| `PROJECT_ROOTS` | Additional project roots, `;`-separated (also `:` on POSIX) | — |
| `WORKSPACE_FILE` | VS Code `.code-workspace` file to read project roots from | — |
| `COMPILE_COMMANDS_DIR` | Forces one compile_commands.json directory for every file | Resolved per file |
| `CLANGD_MAX_INSTANCES` | Maximum concurrent clangd instances (least recently used is evicted) | `8` |
| `CLANGD_PATH` | Path to clangd binary | Auto-detected |
| `CLANGD_ARGS` | Additional clangd arguments | Auto-configured |
| `LOG_LEVEL` | MCP log level (ERROR/WARN/INFO/DEBUG) | `INFO` |
| `CLANGD_LOG_LEVEL` | Clangd log level | `error` |

**Clangd auto-detection order:** `CLANGD_PATH` → project bundled (Chromium: `third_party/llvm-build/.../clangd`) → system PATH

Some large projects bundle their own clangd.

**Chromium** is auto-detected at `third_party/llvm-build/Release+Asserts/bin/clangd`. 

For other projects in a similar situation, set `CLANGD_PATH` to specify the bundled clangd.

For bettern performance, background indexing is disabled by default. Usually there is already an axisting `clangd` server taking care of indexing the codebase. You can enable it with:

```json
{"env": {"CLANGD_ARGS": "--background-index --limit-results=1000"}}
```

Large projects might consider using [remote index](https://clangd.llvm.org/design/remote-index).

Verbose logging may be enabled with:

```json
{"env": {"LOG_LEVEL": "DEBUG", "CLANGD_LOG_LEVEL": "verbose"}}
```

**Examples:**

```js
// Chromium (auto-detects bundled clangd)
{"mcpServers": {"clangd": {"command": "clangd-mcp-server",
  "env": {"PROJECT_ROOT": "/home/user/chromium/src"},
  "alwaysAllow": ["*"]}}}

// Custom clangd binary
{"mcpServers": {"clangd": {"command": "clangd-mcp-server",
  "env": {"CLANGD_PATH": "/custom/path/clangd"},
  "alwaysAllow": ["*"]}}}

// Custom args (e.g., enable background indexing)
{"mcpServers": {"clangd": {"command": "clangd-mcp-server",
  "env": {"CLANGD_ARGS": "--background-index --limit-results=1000"},
  "alwaysAllow": ["*"]}}}
```

## Architecture

```
Claude Code
    ↓ MCP (stdio)
clangd-mcp-server
    ├── CompilationDatabaseResolver (maps a file to its compile_commands.json)
    ├── ClangdPool (one clangd instance per database, LRU bounded)
    │     └── ClangdManager (lifecycle, health monitoring)
    │           ├── LSPClient (JSON-RPC over stdio)
    │           └── FileTracker (didOpen/didClose)
    └── Tools (find_definition, find_references, etc.)
        ↓ LSP requests
    clangd subprocess (one per project)
```

## Development

```bash
npm install        # Install
npm run build      # Build
npm run watch      # Watch mode
npm test           # Run tests
node dist/index.js # Test locally
```

### Dependency overrides

`package.json` pins `@hono/node-server` to `^2.0.11` through `overrides`. The MCP
SDK depends on `^1.19.9`, but the `serve-static` path traversal fix
([GHSA-frvp-7c67-39w9](https://github.com/advisories/GHSA-frvp-7c67-39w9)) only
landed in 2.0.5. Version 2 keeps the same `hono@^4` peer the SDK already
installs, and this server uses stdio only, so the HTTP transport that pulls hono
in is never loaded.

`npm audit --omit=dev` reports no vulnerabilities. The remaining dev-only
advisories come from `brace-expansion` in the jest toolchain, which has no
patched release upstream and never ships.

## License

MPL-2.0 - See [LICENSE](LICENSE)

## References

[Model Context Protocol](https://modelcontextprotocol.io) • [clangd](https://clangd.llvm.org) • [LSP](https://microsoft.github.io/language-server-protocol/)
