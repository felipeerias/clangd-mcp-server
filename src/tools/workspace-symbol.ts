// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { LSPClient } from '../lsp-client.js';
import { uriToPath } from '../utils/uri.js';
import { withRetry } from '../utils/errors.js';
import { symbolKindNames } from '../utils/lsp-types.js';

interface SymbolInformation {
  name: string;
  kind: number;
  location: {
    uri: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
  containerName?: string;
}

export async function workspaceSymbolSearch(
  lspClient: LSPClient,
  query: string,
  limit: number = 100
): Promise<string> {
  return workspaceSymbolSearchMulti([{ projectRoot: '', lspClient }], query, limit);
}

export interface SymbolSearchTarget {
  /** Project root the client serves; reported alongside each symbol. */
  projectRoot: string;
  lspClient: LSPClient;
}

/**
 * Query every project in the workspace and merge the results.
 *
 * clangd scopes workspace/symbol to the compilation database it was started
 * with, so a multi-project workspace needs one query per project to see all
 * matches.
 */
export async function workspaceSymbolSearchMulti(
  targets: SymbolSearchTarget[],
  query: string,
  limit: number = 100
): Promise<string> {
  const searched: string[] = [];
  const failures: { project: string; error: string }[] = [];
  const symbols: SymbolInformation[] = [];
  const seen = new Set<string>();

  const responses = await Promise.all(
    targets.map(async target => {
      try {
        const result: SymbolInformation[] = await withRetry(async () => {
          return (await target.lspClient.request('workspace/symbol', { query })) || [];
        });
        return { target, result };
      } catch (error) {
        return { target, error: error instanceof Error ? error.message : String(error) };
      }
    })
  );

  for (const response of responses) {
    if (response.error !== undefined) {
      failures.push({ project: response.target.projectRoot, error: response.error });
      continue;
    }

    searched.push(response.target.projectRoot);
    for (const symbol of response.result ?? []) {
      // The same header can be indexed by several projects; keep one entry.
      const identity = `${symbol.name}|${symbol.location.uri}|${symbol.location.range.start.line}|${symbol.location.range.start.character}`;
      if (seen.has(identity)) {
        continue;
      }
      seen.add(identity);
      symbols.push(symbol);
    }
  }

  // Format results
  if (symbols.length === 0) {
    return JSON.stringify({
      found: false,
      message: `No symbols found matching '${query}'`,
      projects_searched: searched.filter(Boolean),
      failures: failures.length > 0 ? failures : undefined
    });
  }

  // Apply limit
  const limitedSymbols = symbols.slice(0, limit);

  const formattedSymbols = limitedSymbols.map(sym => ({
    name: sym.name,
    kind: symbolKindNames[sym.kind] || `Unknown(${sym.kind})`,
    file: uriToPath(sym.location.uri),
    line: sym.location.range.start.line,
    column: sym.location.range.start.character,
    container: sym.containerName,
    uri: sym.location.uri
  }));

  return JSON.stringify({
    found: true,
    count: symbols.length,
    returned: formattedSymbols.length,
    truncated: symbols.length > limit,
    projects_searched: searched.filter(Boolean),
    failures: failures.length > 0 ? failures : undefined,
    symbols: formattedSymbols
  }, null, 2);
}
