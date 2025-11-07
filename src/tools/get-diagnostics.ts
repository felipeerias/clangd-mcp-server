// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { LSPClient } from '../lsp-client.js';
import { FileTracker } from '../file-tracker.js';
import { Diagnostic, DiagnosticSeverity } from '../utils/lsp-types.js';
import { uriToPath } from '../utils/uri.js';
import { TimeoutError, withTimeout } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Manages a cache of diagnostics received from clangd via publishDiagnostics notifications
 */
export class DiagnosticsCache {
  private cache: Map<string, Diagnostic[]> = new Map();
  private pendingWaits: Map<string, Array<(diagnostics: Diagnostic[]) => void>> = new Map();

  constructor(lspClient: LSPClient) {
    // Listen for publishDiagnostics notifications from clangd
    lspClient.onNotification('textDocument/publishDiagnostics', (params: any) => {
      const uri = params.uri as string;
      const diagnostics = params.diagnostics as Diagnostic[];

      logger.debug(`Received diagnostics for ${uri}: ${diagnostics.length} items`);

      // Update cache
      this.cache.set(uri, diagnostics);

      // Notify any pending waiters
      const waiters = this.pendingWaits.get(uri);
      if (waiters) {
        for (const resolve of waiters) {
          resolve(diagnostics);
        }
        this.pendingWaits.delete(uri);
      }
    });
  }

  /**
   * Get diagnostics for a file URI
   * If force_refresh is true, clears cache and waits for new diagnostics
   */
  async getDiagnostics(uri: string, forceRefresh: boolean = false): Promise<Diagnostic[]> {
    if (forceRefresh) {
      logger.info(`Force refresh requested for ${uri}`);
      this.cache.delete(uri);
    }

    // If cached, return immediately
    if (this.cache.has(uri)) {
      return this.cache.get(uri)!;
    }

    // Otherwise, wait for diagnostics to arrive (file should already be opened)
    return this.waitForDiagnostics(uri, 5000);
  }

  /**
   * Wait for diagnostics to be published for a given URI
   */
  private async waitForDiagnostics(uri: string, timeoutMs: number): Promise<Diagnostic[]> {
    // Check if already cached (race condition)
    if (this.cache.has(uri)) {
      return this.cache.get(uri)!;
    }

    const promise = new Promise<Diagnostic[]>((resolve) => {
      // Add to pending waiters
      const waiters = this.pendingWaits.get(uri) || [];
      waiters.push(resolve);
      this.pendingWaits.set(uri, waiters);
    });

    try {
      return await withTimeout(
        promise,
        timeoutMs,
        `Timeout waiting for diagnostics for ${uri}`
      );
    } catch (error) {
      // Clean up pending waiters on timeout
      this.pendingWaits.delete(uri);

      if (error instanceof TimeoutError) {
        logger.warn(`Timeout waiting for diagnostics: ${uri}`);
        // Return empty diagnostics array instead of throwing
        return [];
      }
      throw error;
    }
  }

  /**
   * Clear diagnostics for a specific file (called when FileTracker evicts)
   */
  clearForFile(uri: string): void {
    logger.debug(`Clearing diagnostics cache for ${uri}`);
    this.cache.delete(uri);
    this.pendingWaits.delete(uri);
  }

  /**
   * Get the current cache size (for debugging)
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}

/**
 * Tool implementation for get_diagnostics
 */
export async function getDiagnostics(
  diagnosticsCache: DiagnosticsCache,
  fileTracker: FileTracker,
  filePath: string,
  forceRefresh: boolean = false
): Promise<string> {
  // Ensure file is opened (will trigger diagnostics)
  const uri = await fileTracker.ensureFileOpen(filePath);

  // Get diagnostics from cache (or wait for them)
  const diagnostics = await diagnosticsCache.getDiagnostics(uri, forceRefresh);

  // Count by severity
  const counts = {
    errors: 0,
    warnings: 0,
    information: 0,
    hints: 0
  };

  for (const diag of diagnostics) {
    switch (diag.severity) {
      case DiagnosticSeverity.Error:
        counts.errors++;
        break;
      case DiagnosticSeverity.Warning:
        counts.warnings++;
        break;
      case DiagnosticSeverity.Information:
        counts.information++;
        break;
      case DiagnosticSeverity.Hint:
        counts.hints++;
        break;
    }
  }

  // Format diagnostics for output
  const formattedDiagnostics = diagnostics.map(diag => {
    const severityName =
      diag.severity === DiagnosticSeverity.Error ? 'error' :
      diag.severity === DiagnosticSeverity.Warning ? 'warning' :
      diag.severity === DiagnosticSeverity.Information ? 'information' :
      diag.severity === DiagnosticSeverity.Hint ? 'hint' :
      'unknown';

    const formatted: any = {
      severity: severityName,
      message: diag.message,
      location: {
        line: diag.range.start.line,
        column: diag.range.start.character
      },
      range: {
        start: {
          line: diag.range.start.line,
          column: diag.range.start.character
        },
        end: {
          line: diag.range.end.line,
          column: diag.range.end.character
        }
      }
    };

    if (diag.code !== undefined) {
      formatted.code = diag.code;
    }

    if (diag.source) {
      formatted.source = diag.source;
    }

    if (diag.relatedInformation && diag.relatedInformation.length > 0) {
      formatted.relatedInformation = diag.relatedInformation.map(info => ({
        location: {
          file: uriToPath(info.location.uri),
          line: info.location.range.start.line,
          column: info.location.range.start.character
        },
        message: info.message
      }));
    }

    return formatted;
  });

  return JSON.stringify({
    file: filePath,
    diagnostic_count: counts,
    diagnostics: formattedDiagnostics
  }, null, 2);
}
