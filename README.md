# Clangd MCP Server

[Model Context Protocol](https://modelcontextprotocol.io) server that bridges Claude Code with clangd for C++ code intelligence on large codebases.

## Features

**9 Code Intelligence Tools:**
- `find_definition` - Jump to symbol definitions
- `find_references` - Find all references to a symbol
- `get_hover` - Get type information and documentation
- `workspace_symbol_search` - Search symbols across workspace
- `find_implementations` - Find interface/virtual method implementations
- `get_document_symbols` - Get hierarchical symbol tree for a file
- `get_diagnostics` - Get compiler errors, warnings, and notes
- `get_call_hierarchy` - Get function callers and callees
- `get_type_hierarchy` - Get base classes and derived classes

**Architecture:**
- Long-lived clangd with crash recovery and lazy initialization
- Proper LSP lifecycle management (didOpen/didClose)
- Timeout/retry with exponential backoff
- Chromium-scale ready

## Requirements

- Node.js >= 18.0.0
- clangd (install via your package manager or LLVM)
- A C++ project with `compile_commands.json`

### Installing clangd

**Ubuntu/Debian:**
```bash
sudo apt install clangd
```

**macOS:**
```bash
brew install llvm
# clangd will be at /opt/homebrew/opt/llvm/bin/clangd
```

**From LLVM releases:**
Download from https://github.com/clangd/clangd/releases

**Large projects with bundled clangd:**
- **Chromium**: Auto-detected at `third_party/llvm-build/Release+Asserts/bin/clangd`
- **Other projects**: Set `CLANGD_PATH` to specify bundled clangd

## Installation

```bash
# From npm (when published)
npm install -g clangd-mcp-server

# From source
git clone https://github.com/yourusername/language-server-mcp.git
cd language-server-mcp
npm install && npm run build && npm link
```

## Configuration

### Generating compile_commands.json

**CMake:** `cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON /path/to/source`
**GN (Chromium):** `gn gen out/Default`
**Other:** Use [Bear](https://github.com/rizsotto/Bear)

### Claude Code Configuration

Add to `~/.claude.json` or `.claude.json`:

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

**Examples:**

```json
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

## Usage

Claude Code uses these tools via natural language:

| Tool | Example Query |
|------|---------------|
| `find_definition` | "Find the definition at src/foo.cpp:42:10" |
| `find_references` | "Find all references to the function at bar.h:100" |
| `get_hover` | "What's the type at baz.cpp:200:15?" |
| `workspace_symbol_search` | "Find symbols matching 'HttpRequest'" |
| `find_implementations` | "Find implementations of interface.h:50" |
| `get_document_symbols` | "Show all symbols in main.cpp" |
| `get_diagnostics` | "Show errors in src/foo.cpp" |
| `get_call_hierarchy` | "Show callers/callees at main.cpp:100:5" |
| `get_type_hierarchy` | "Show base/derived classes at foo.h:42" |

**Note:** LSP uses 0-indexed line/column. Claude handles conversion automatically.

## Performance

**Background indexing disabled by default** for lower memory (<500MB) and faster startup. Files indexed on-demand.

**Tradeoffs:**
- ✅ Low memory/CPU, fast startup (<5s)
- ⚠️ `workspace_symbol_search` limited to opened files
- ⚠️ First query/file: 5-15s; subsequent: 1-5s

**Enable for workspace-wide search** (costs GBs RAM, hours indexing):
```json
{"env": {"CLANGD_ARGS": "--background-index --limit-results=1000"}}
```

**Chromium-scale:** Use [remote index](https://clangd.llvm.org/design/remote-index) instead.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `spawn clangd ENOENT` | Install clangd or set `CLANGD_PATH` |
| `compile_commands.json not found` | Generate with CMake/GN/Bear (see Configuration) |
| `timed out after 30000ms` | File not in build, or clangd indexing; wait/retry or check logs |
| `Max restart attempts reached` | Check clangd version/stderr, validate compile_commands.json |

**Enable verbose logging:**
```json
{"env": {"LOG_LEVEL": "DEBUG", "CLANGD_LOG_LEVEL": "verbose"}}
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

## Known Limitations

- No file watching (changes need manual refresh)
- Single clangd instance per project root
- Doesn't bundle clangd binary

## License

MPL-2.0 - See [LICENSE](LICENSE)

## References

[Model Context Protocol](https://modelcontextprotocol.io) • [clangd](https://clangd.llvm.org) • [LSP](https://microsoft.github.io/language-server-protocol/)
