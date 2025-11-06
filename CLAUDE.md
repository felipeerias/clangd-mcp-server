# CLAUDE.md

Guidance for Claude Code when working with this MCP server codebase.

## Project Overview

MCP server that bridges Claude Code with clangd LSP for C++ code intelligence on large codebases (Chromium-scale). Production-ready with 6 tools, crash recovery, and lazy initialization.

## Critical Patterns

### Adding New LSP Tools

1. Create `src/tools/your-tool.ts` with MPL-2.0 header
2. Follow pattern: `fileTracker.ensureFileOpen()` → `withRetry(() => lspClient.request())` → return JSON string
3. Register in `src/index.ts`: import, add to ListToolsRequestSchema, add case to CallToolRequestSchema
4. Build with `npm run build`

See existing tools (find-definition.ts, find-references.ts) for examples.

### Key Gotchas

- **URI handling**: Always use `normalizeToUri()/uriToPath()` from utils/uri.ts, never mix paths and URIs
- **File lifecycle**: Must call `fileTracker.ensureFileOpen()` before any file-based LSP request
- **LSP results**: textDocument/definition returns `Location | Location[] | null` - normalize to array
- **Imports**: Must use `.js` extension (ES modules), not `.ts`
- **Positions**: LSP uses 0-indexed line/column

## Architecture Notes

- **ClangdManager** (src/clangd-manager.ts): Subprocess lifecycle, auto-restart on crash (max 3 attempts)
- **LSPClient** (src/lsp-client.ts): JSON-RPC over stdio, Content-Length framing, request correlation
- **FileTracker** (src/file-tracker.ts): Manages didOpen/didClose, prevents duplicates
- **ConfigDetector** (src/config-detector.ts): Auto-detects compile_commands.json, project type detection, and project bundled clangd (Chromium auto-detected, others via CLANGD_PATH)

Data flow: MCP request → index.ts routes → FileTracker opens file → LSPClient sends request → format response

## Design Decisions

- **Background indexing OFF by default**: MCP sporadic queries don't benefit, saves GBs of memory
- **Lazy initialization**: clangd starts on first query, not at server startup
- **ES modules**: Required by MCP SDK, all imports need .js extension
- **Retry logic**: Exponential backoff for transient LSP errors (100ms → 200ms → 400ms, max 3 attempts)
- **Project bundled clangd**: Auto-detects project bundled clangd (Chromium supported via `.gclient` detection) and allows manual specification via `CLANGD_PATH` for other projects, with version validation and warnings

## License

MPL-2.0. All new source files must include the MPL-2.0 header:

```typescript
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
```
