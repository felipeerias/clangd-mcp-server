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
| `PROJECT_ROOT` | Project workspace root | Current directory |
| `COMPILE_COMMANDS_DIR` | Path to compile_commands.json directory | Auto-detected |
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
    ├── ClangdManager (lifecycle, health monitoring)
    ├── LSPClient (JSON-RPC over stdio)
    ├── FileTracker (didOpen/didClose)
    └── Tools (find_definition, find_references, etc.)
        ↓ LSP requests
    clangd subprocess
```

## Development

```bash
npm install        # Install
npm run build      # Build
npm run watch      # Watch mode
npm test           # Run tests
node dist/index.js # Test locally
```

## License

MPL-2.0 - See [LICENSE](LICENSE)

## References

[Model Context Protocol](https://modelcontextprotocol.io) • [clangd](https://clangd.llvm.org) • [LSP](https://microsoft.github.io/language-server-protocol/)
