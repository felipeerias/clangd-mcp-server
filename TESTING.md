# Testing Guide

## Running Tests

```bash
npm test           # All tests
npm run test:unit  # Unit tests only
npm run test:watch # Watch mode
```

## Coverage

**Core modules tested** (~60% coverage, 95+ tests):
- Utils (uri, errors, logger)
- Config detector (bundled clangd, compile_commands.json)
- LSP client (JSON-RPC, message framing, concurrent requests)
- File tracker (didOpen/didClose, language detection)

**Not yet tested:**
- Clangd manager (spawning, crash recovery)
- Tools (9 tools: definition, references, hover, workspace symbols, implementations, document symbols, diagnostics, call hierarchy, type hierarchy)
- Integration/E2E tests

## Test Helpers

- `tests/helpers/mock-streams.ts` - Mock stdio, LSP messages
- `tests/helpers/mock-lsp-responses.ts` - Pre-built LSP responses
- `tests/helpers/mock-process.ts` - Mock child process

## Writing Tests

Example:
```typescript
import { describe, it, expect } from '@jest/globals';
import { myFunction } from '../../../src/my-module.js';

describe('MyModule', () => {
  it('should handle success case', async () => {
    const result = await myFunction('input');
    expect(result).toMatchObject({status: 'ok'});
  });
});
```

**Guidelines:**
- Follow AAA: Arrange, Act, Assert
- Test edge cases and errors
- Mock external dependencies (filesystem, processes)
- Use helpers from `tests/helpers/`
- Clean up resources (files, env vars)

## Troubleshooting

- **Cannot find module**: Run `npm run build`, check `.js` extensions in imports
- **Timeouts**: Increase in `jest.config.js` or per-test with timeout arg
- **Flaky tests**: Avoid fixed timeouts, clean up properly
