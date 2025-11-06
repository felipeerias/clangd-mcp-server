# Clangd MCP Server

An experimental [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that enables Claude Code to connect to clangd LSP for enhanced C++ code intelligence on large codebases.

## Overview

This MCP server bridges Claude Code with clangd (the Language Server Protocol implementation for C/C++), enabling rich code navigation capabilities without requiring full codebase indexing by Claude. It's designed to work efficiently with Chromium-scale codebases.

## Features

- **Code Navigation Tools**:
  - `find_definition` - Jump to symbol definitions
  - `find_references` - Find all references to a symbol
  - `get_hover` - Get type information and documentation
  - `workspace_symbol_search` - Search symbols across the workspace
  - `find_implementations` - Find interface/virtual method implementations
  - `get_document_symbols` - Get hierarchical symbol tree for a file

- **Robust Architecture**:
  - Long-lived clangd process with automatic crash recovery
  - Lazy initialization (clangd starts on first query)
  - Configurable for different project sizes (Chromium vs normal projects)
  - Proper LSP lifecycle management (didOpen/didClose)
  - Timeout and retry handling with exponential backoff

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
Some large projects bundle their own clangd for version consistency:
- **Chromium**: Automatically detected at `third_party/llvm-build/Release+Asserts/bin/clangd`
- **Other projects**: Use `CLANGD_PATH` environment variable to specify the bundled clangd location

The MCP server automatically uses the bundled version when detected, ensuring version compatibility.

## Installation

### Option 1: Install from npm (when published)

```bash
npm install -g clangd-mcp-server
```

### Option 2: Install from source

```bash
git clone https://github.com/yourusername/language-server-mcp.git
cd language-server-mcp
npm install
npm run build
npm link
```

## Configuration

### Generating compile_commands.json

Clangd requires a `compile_commands.json` file to understand your project's build configuration.

**CMake projects:**
```bash
cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON /path/to/source
```

**Chromium/GN projects:**
```bash
gn gen out/Default
# compile_commands.json will be in out/Default/
```

**Other build systems:**
- See [Bear](https://github.com/rizsotto/Bear) for capturing compile commands

### Claude Code Configuration

Add the MCP server to your Claude Code configuration file (`~/.claude.json` or project-specific `.claude.json`):

```json
{
  "mcpServers": {
    "clangd": {
      "command": "clangd-mcp-server",
      "env": {
        "PROJECT_ROOT": "/path/to/your/project",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### Environment Variables

Configure the server behavior using environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PROJECT_ROOT` | Project workspace root directory | Current working directory |
| `COMPILE_COMMANDS_DIR` | Explicit path to directory containing compile_commands.json | Auto-detected |
| `CLANGD_PATH` | Path to clangd binary (overrides all auto-detection) | Auto-detected (see below) |
| `CLANGD_ARGS` | Additional clangd arguments | Auto-configured based on project |
| `CLANGD_LOG_LEVEL` | Clangd's internal log level | `error` |
| `LOG_LEVEL` | MCP server log level (ERROR, WARN, INFO, DEBUG) | `INFO` |

**Clangd Binary Auto-Detection (in order of precedence):**
1. `CLANGD_PATH` environment variable (manual override for any clangd binary)
2. Auto-detected project bundled clangd:
   - **Chromium**: Automatically detects bundled clangd at:
     - `third_party/llvm-build/Release+Asserts/bin/clangd`
     - `third_party/llvm-build/Release/bin/clangd`
3. System `clangd` from PATH

The server logs which clangd binary and version is being used on startup.

### Advanced Examples

```json
// Chromium project (auto-detects bundled clangd)
{"mcpServers": {"clangd": {"command": "clangd-mcp-server", "env": {
  "PROJECT_ROOT": "/home/user/chromium/src",
  "COMPILE_COMMANDS_DIR": "/home/user/chromium/src/out/Default"
}}}}

// Project with custom/bundled clangd
{"mcpServers": {"clangd": {"command": "clangd-mcp-server", "env": {
  "PROJECT_ROOT": "/home/user/myproject",
  "CLANGD_PATH": "/home/user/myproject/tools/clangd/bin/clangd"
}}}}

// System clangd with custom args
{"mcpServers": {"clangd": {"command": "clangd-mcp-server", "env": {
  "CLANGD_PATH": "/opt/homebrew/opt/llvm/bin/clangd",
  "CLANGD_ARGS": "--header-insertion=never --completion-style=detailed"
}}}}
```

## Usage

Once configured, Claude Code can use these tools via natural language:

| Tool | Purpose | Example Query |
|------|---------|---------------|
| `find_definition` | Jump to symbol definition | "Find the definition of the symbol at line 42, column 10 in src/foo.cpp" |
| `find_references` | Find all references to symbol | "Find all references to the function in include/bar.h at line 100" |
| `get_hover` | Get type info and docs | "What is the type of the variable at line 200 in src/baz.cpp?" |
| `workspace_symbol_search` | Search symbols project-wide | "Find all symbols matching 'HttpRequest'" |
| `find_implementations` | Find interface/virtual implementations | "Find implementations of the method at line 50 in interface.h" |
| `get_document_symbols` | Get file's symbol hierarchy | "Show me all symbols in src/main.cpp" |

**Note:** LSP uses 0-indexed line/column numbers. Claude handles the conversion automatically.

## Performance

### Background Indexing (Disabled by Default)

Background indexing is **disabled** (`--background-index=false`) because MCP makes sporadic queries, not continuous edits. On-demand indexing saves GBs of memory while still indexing files as queried.

**Tradeoffs:**
- ✅ Lower memory/CPU, faster startup
- ⚠️ `workspace_symbol_search` limited to already-opened files
- ⚠️ First query per file: 5-15s (subsequent: 1-5s)

**Enable for workspace-wide search** (costs: hours to index, high memory):
```json
{"mcpServers": {"clangd": {"command": "clangd-mcp-server", "env": {
  "CLANGD_ARGS": "--background-index --limit-references=1000 --limit-results=1000"
}}}}
```

**Chromium-scale projects:** Use [remote index server](https://clangd.llvm.org/design/remote-index) instead.

**Typical performance:**
- Warm files: 1-5s | Cold files: 5-15s | Startup: <5s | Memory: <500MB

## Troubleshooting

| Problem | Cause/Error | Solution |
|---------|-------------|----------|
| **Clangd not found** | `spawn clangd ENOENT` | Install clangd or set `CLANGD_PATH` env var |
| **Missing compile_commands.json** | `compile_commands.json not found` | Generate it (see Configuration) with CMake/GN/Bear |
| **Wrong clangd version** | Warning about old clangd | The server auto-detects bundled clangd (e.g., Chromium). Check startup logs. Use `CLANGD_PATH` to override |
| **Timeout** | `timed out after 30000ms` | File not in build, or clangd indexing (wait/retry), or check with `CLANGD_LOG_LEVEL=verbose` |
| **Crashes** | `Max restart attempts reached` | Check clangd version (see startup logs), stderr logs, try different `CLANGD_ARGS`, validate compile_commands.json |

**Enable verbose logging:**
```json
{"mcpServers": {"clangd": {"command": "clangd-mcp-server", "env": {
  "LOG_LEVEL": "DEBUG", "CLANGD_LOG_LEVEL": "verbose"
}}}}
```
Check stderr in Claude Code logs.

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
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run watch

# Test locally
node dist/index.js
```

## License

This project is licensed under the Mozilla Public License Version 2.0 (MPL-2.0).
See [LICENSE](LICENSE) file for details.

## Contributing

Contributions welcome! This is an experimental project. Please open issues for bugs or feature requests.

## Known Limitations

- Does not connect to IDE-managed clangd instances
- No file watching (changes require manual didChange, not implemented)
- No custom compilation database generation
- Does not bundle clangd binary
- Single clangd instance per MCP server (one per project root)

## References

- [Model Context Protocol](https://modelcontextprotocol.io)
- [clangd](https://clangd.llvm.org)
- [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
