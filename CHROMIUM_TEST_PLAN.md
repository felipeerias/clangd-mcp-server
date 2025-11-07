# Chromium MCP Server Testing Plan

Comprehensive testing plan for validating all 9 MCP tools on a Chromium codebase using Claude Code with the clangd MCP server.

## Overview

This plan tests the clangd-mcp-server on a real Chromium codebase to validate:
- All 9 code intelligence tools work correctly
- Chromium auto-detection and bundled clangd support
- Error handling and edge cases
- Performance characteristics (lazy init, on-demand indexing)

**Estimated time:** 35 minutes

---

## Prerequisites Verification (5 minutes)

Before starting, verify:

1. **Chromium project structure exists**
   - Check for `third_party/`, `base/`, `chrome/` directories

2. **MCP server is loaded**
   - MCP server should be configured in `.claude.json` or `~/.claude.json`
   - Ask Claude: "List available MCP tools" → should show 9 clangd tools

3. **compile_commands.json exists**
   - Check: `out/Default/compile_commands.json` or `out/Release/compile_commands.json`
   - If missing: Run `gn gen out/Default` to generate

4. **Chromium bundled clangd detected**
   - Check MCP logs for: "Using Chromium bundled clangd" or "Detected Chromium project"
   - Expected clangd version: v22+ from `third_party/llvm-build/Release+Asserts/bin/clangd`

---

## Phase 1: Basic Tool Testing (15 minutes)

### Test 1: `find_definition`

**Objective:** Jump to symbol definitions

**Test case:**
```
File: base/logging.h
Target: LOG macro (around line 150-200)
Query: "Find the definition of LOG at base/logging.h:150:10"
```

**Expected result:**
- JSON with `found: true`
- `locations` array containing definition location
- Location has: `file` (path), `line` (0-indexed), `column` (0-indexed)

**Validation:**
- Definition location should be in the same file or related header
- Line/column should be valid integers

---

### Test 2: `find_references`

**Objective:** Find all references to a symbol

**Test case:**
```
File: base/memory/ref_counted.h
Target: RefCounted class (around line 200-250)
Query: "Find all references to RefCounted at base/memory/ref_counted.h:200:8"
Alternative: "Find references to the class at line 200 column 8 in base/memory/ref_counted.h"
```

**Expected result:**
- JSON with reference `count` (likely dozens to hundreds)
- `locations` array with file paths across Chromium
- Each location has file, line, column

**Validation:**
- Count should be > 0
- References should span multiple files (this is a widely used class)
- With `include_declaration: false`, should not include the class definition itself

---

### Test 3: `get_hover`

**Objective:** Get type information and documentation

**Test case:**
```
File: base/strings/string_util.h
Target: Any string utility function (e.g., StartsWith, EndsWith)
Query: "What's the type information at base/strings/string_util.h:100:5?"
```

**Expected result:**
- JSON with hover information
- Should contain function signature or type
- May contain documentation comments

**Validation:**
- Response should have type/signature information
- Should be human-readable

---

### Test 4: `workspace_symbol_search`

**Objective:** Search symbols across workspace

**Test case:**
```
Query: "Search for symbols matching 'MessageLoop'"
Alternative queries: "HttpRequest", "TaskRunner", "base::Callback"
```

**Expected result:**
- JSON with array of symbol matches
- Each symbol has: name, kind (class/function/etc), location
- **Note:** Limited results if background indexing is OFF (default)

**Validation:**
- Should find at least some symbols (files already opened)
- Limit parameter should be respected (default 100)
- If many results, should be truncated appropriately

**Note:** Full workspace search requires background indexing enabled via:
```json
{"env": {"CLANGD_ARGS": "--background-index --limit-results=1000"}}
```

---

### Test 5: `find_implementations`

**Objective:** Find implementations of interfaces/virtual methods

**Test case:**
```
File: base/task/task_runner.h
Target: PostTask virtual method (interface method)
Query: "Find implementations of the method at base/task/task_runner.h:50:15"
```

**Expected result:**
- JSON with implementations in derived classes
- Multiple locations across different TaskRunner implementations

**Validation:**
- Should find concrete implementations (not just the declaration)
- Locations should be in different files/classes

---

### Test 6: `get_document_symbols`

**Objective:** Get hierarchical symbol tree for a file

**Test case:**
```
File: base/callback.h
Query: "Show all symbols in base/callback.h"
Alternative: "Get document symbols for base/callback.h"
```

**Expected result:**
- JSON with hierarchical symbol structure
- Top-level: namespaces, classes
- Nested: methods, fields, nested classes
- Each symbol has: name, kind, range

**Validation:**
- Should show class hierarchies
- Symbol kinds should include: namespace, class, method, field, etc.
- Ranges should have valid line/column positions

---

### Test 7: `get_diagnostics`

**Objective:** Get compiler errors, warnings, and notes

**Test case option A (existing file):**
```
File: Any .cc file in the build
Query: "Show diagnostics for base/files/file_util.cc"
```

**Test case option B (introduce error):**
```
1. Create test file: base/test_diagnostics.cc
2. Add syntax error: "int main( { return 0; }"  // missing )
3. Query: "Get diagnostics for base/test_diagnostics.cc"
```

**Expected result:**
- JSON with `diagnostic_count`: errors, warnings, information, hints
- `diagnostics` array with severity, message, location, range
- May include `code` (error code), `source` (clang/clangd)
- May include `relatedInformation` for complex errors

**Validation:**
- Severity levels: error (1), warning (2), information (3), hint (4)
- Each diagnostic has line/column range
- Messages should be human-readable

**Note:** Use `force_refresh: true` to re-parse and get latest diagnostics

---

### Test 8: `get_call_hierarchy`

**Objective:** Get callers and callees of a function

**Test case:**
```
File: base/run_loop.cc
Target: Run() method (around line 100-150)
Query: "Show call hierarchy for the function at base/run_loop.cc:120:6"
```

**Expected result:**
- JSON with `incoming_calls` (callers) and `outgoing_calls` (callees)
- Each call has: `from` location, `fromRanges` (where the call happens)
- Function info includes: name, kind, detail

**Validation:**
- Should show what calls this function (incoming)
- Should show what this function calls (outgoing)
- Ranges should be valid

---

### Test 9: `get_type_hierarchy`

**Objective:** Get base classes and derived classes

**Test case:**
```
File: base/observer_list.h
Target: ObserverList class or any class with inheritance
Query: "Show type hierarchy at base/observer_list.h:50:7"
Alternative file: content/public/browser/web_contents.h (has inheritance)
```

**Expected result:**
- JSON with `supertypes` (base classes) and `subtypes` (derived classes)
- Each type has: name, kind, detail, uri, range
- Shows inheritance chain

**Validation:**
- Supertypes should show parent classes
- Subtypes should show child classes (if any)
- Should handle multiple inheritance

---

## Phase 2: Edge Cases & Error Handling (10 minutes)

### Test 10: Non-existent file
```
Query: "Find definition at /nonexistent/file.cc:10:5"
Expected: JSON with error: true, message explaining file not found
```

### Test 11: Invalid line/column
```
Query: "Find definition at base/logging.h:999999:9999"
Expected: Empty result or error (graceful handling)
```

### Test 12: Empty workspace search
```
Query: "Search for symbols matching ''"
Expected: Error or empty results
```

### Test 13: File outside compile_commands.json
```
Query: Try a file not in the build (e.g., README.md, a test file not compiled)
Expected: Timeout or "not in compile commands" error
```

### Test 14: Large generated file
```
Query: Any file in out/Default/gen/ (generated protobuf files, etc.)
Expected: May be slow but should complete or timeout gracefully
```

---

## Phase 3: Performance Testing (5 minutes)

### First query (cold start)
- **Action:** First MCP tool call after starting Claude Code
- **Expected:** 5-15 seconds (clangd initialization + file indexing)
- **What happens:** Lazy init, clangd spawns, parses file

### Subsequent queries (same file)
- **Action:** Second query on the same file
- **Expected:** 1-5 seconds (file already indexed)

### Different file query
- **Action:** Query on a new file not previously opened
- **Expected:** 5-15 seconds (on-demand indexing for that file)

### Background indexing verification
- **Check:** MCP logs should show `--background-index=false`
- **Why:** Default is OFF for MCP sporadic queries (saves memory)
- **Memory:** Should stay under 500MB (vs GBs with background indexing)

---

## Phase 4: Configuration Verification (5 minutes)

### Chromium auto-detection
Check MCP server logs for:
- "Detected Chromium project"
- "Using Chromium bundled clangd: .../third_party/llvm-build/.../clangd"
- "Clangd version: 22.x.x" (or higher)
- "Found compile_commands.json at: .../out/Default/compile_commands.json"

### Arguments check
Logs should show clangd args include:
- `--compile-commands-dir=.../out/Default`
- `--background-index=false`
- `--limit-references=1000`
- `--limit-results=1000`
- `--malloc-trim`
- `--pch-storage=memory`
- `--clang-tidy=false`

---

## Success Criteria

| Category | Criteria | Status |
|----------|----------|--------|
| **Tools** | All 9 tools produce valid JSON | [ ] |
| **Tools** | No tool crashes or hangs | [ ] |
| **Detection** | Chromium project auto-detected | [ ] |
| **Detection** | Bundled clangd auto-detected (v22+) | [ ] |
| **Detection** | compile_commands.json found automatically | [ ] |
| **Errors** | Graceful error handling for invalid inputs | [ ] |
| **Performance** | First query: 5-15s (acceptable) | [ ] |
| **Performance** | Subsequent queries: 1-5s (acceptable) | [ ] |
| **Performance** | Memory usage < 500MB | [ ] |
| **Config** | Background indexing OFF by default | [ ] |

---

## Common Issues & Troubleshooting

### Issue: "spawn clangd ENOENT"
- **Cause:** clangd not found
- **Fix:** Install clangd or set `CLANGD_PATH` env var

### Issue: "compile_commands.json not found"
- **Cause:** Build not generated
- **Fix:** Run `gn gen out/Default` in Chromium

### Issue: "timed out after 30000ms"
- **Cause:** File not in build, or clangd still indexing
- **Fix:** Wait and retry, or check if file is in compile_commands.json

### Issue: "Max restart attempts reached"
- **Cause:** clangd crashing repeatedly
- **Fix:** Check clangd version compatibility, validate compile_commands.json, enable verbose logging

### Enable verbose logging:
```json
{
  "mcpServers": {
    "clangd": {
      "command": "clangd-mcp-server",
      "env": {
        "PROJECT_ROOT": "/path/to/chromium/src",
        "LOG_LEVEL": "DEBUG",
        "CLANGD_LOG_LEVEL": "verbose"
      }
    }
  }
}
```

---

## Example Queries for Claude Code

Copy-paste these natural language queries:

```
# Tool 1
"Find the definition of LOG at base/logging.h:150:10"

# Tool 2
"Find all references to RefCounted in base/memory/ref_counted.h at line 200"

# Tool 3
"What's the type at base/strings/string_util.h:100:5?"

# Tool 4
"Search for symbols matching 'MessageLoop'"

# Tool 5
"Find implementations of the method at base/task/task_runner.h:50:15"

# Tool 6
"Show all symbols in base/callback.h"

# Tool 7
"Show errors and warnings in base/files/file_util.cc"

# Tool 8
"Show call hierarchy for the function at base/run_loop.cc:120:6"

# Tool 9
"Show type hierarchy for the class at base/observer_list.h:50:7"
```

---

## Notes for the Testing Instance

- This MCP server uses **lazy initialization** - clangd starts on first query
- **Background indexing is OFF** by default - each file is indexed on-demand when first opened
- For **full workspace symbol search**, would need to enable background indexing (not recommended for Chromium scale)
- **Chromium detection** should happen automatically if the project structure is correct
- All tools return **JSON** - parse and validate structure
- Line/column numbers in MCP tools are **0-indexed** (LSP standard)
- The server automatically manages file lifecycle (didOpen/didClose)

---

## Test Execution Checklist

- [ ] Prerequisites verified (Chromium structure, compile_commands.json, MCP loaded)
- [ ] Test 1: find_definition
- [ ] Test 2: find_references
- [ ] Test 3: get_hover
- [ ] Test 4: workspace_symbol_search
- [ ] Test 5: find_implementations
- [ ] Test 6: get_document_symbols
- [ ] Test 7: get_diagnostics
- [ ] Test 8: get_call_hierarchy
- [ ] Test 9: get_type_hierarchy
- [ ] Edge cases tested (errors handled gracefully)
- [ ] Performance measured (first query ~10s, subsequent ~2s)
- [ ] Configuration verified (Chromium detected, bundled clangd used)

**Overall Result:** PASS / FAIL

---

## Reporting Results

When reporting back, include:
1. Which tools worked / failed
2. Any error messages received
3. Performance measurements (first query time, subsequent query times)
4. Configuration detection (was Chromium detected? Which clangd used?)
5. Any unexpected behavior or issues
