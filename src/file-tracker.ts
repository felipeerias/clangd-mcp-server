// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { readFile } from 'node:fs/promises';
import { logger } from './utils/logger.js';
import { normalizeToUri, uriToPath } from './utils/uri.js';
import { LSPClient } from './lsp-client.js';

/**
 * Tracks which files have been opened in the LSP server
 * and manages didOpen/didClose notifications with LRU eviction
 */
export class FileTracker {
  private openFiles: Map<string, number> = new Map(); // URI -> last access timestamp
  private inFlightOpens: Set<string> = new Set(); // URIs currently being opened
  private lspClient: LSPClient;
  private readonly maxOpenFiles: number = 100; // Maximum files to keep open
  private onFileClosedCallback?: (uri: string) => void;

  constructor(lspClient: LSPClient) {
    this.lspClient = lspClient;
  }

  /**
   * Register a callback that gets called when a file is closed
   */
  onFileClosed(callback: (uri: string) => void): void {
    this.onFileClosedCallback = callback;
  }

  /**
   * Ensure a file is opened in the LSP server before making queries
   * Returns the normalized URI
   */
  async ensureFileOpen(filePath: string): Promise<string> {
    const uri = normalizeToUri(filePath);

    if (this.openFiles.has(uri)) {
      // Update last access time
      this.openFiles.set(uri, Date.now());
      return uri;
    }

    // Check if another call is already opening this file
    if (this.inFlightOpens.has(uri)) {
      // Wait for the in-flight open to complete
      while (this.inFlightOpens.has(uri)) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      // File should now be open, update access time and return
      if (this.openFiles.has(uri)) {
        this.openFiles.set(uri, Date.now());
        return uri;
      }
      // If not open (open failed), fall through to try opening ourselves
    }

    // Mark as in-flight
    this.inFlightOpens.add(uri);

    try {
      // Check if we need to evict old files
      if (this.openFiles.size >= this.maxOpenFiles) {
        this.evictLRU();
      }

      await this.openFile(uri);
      return uri;
    } finally {
      // Always remove from in-flight set
      this.inFlightOpens.delete(uri);
    }
  }

  /**
   * Evict the least recently used file
   */
  private evictLRU(): void {
    let oldestUri: string | null = null;
    let oldestTime = Infinity;

    for (const [uri, time] of this.openFiles.entries()) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestUri = uri;
      }
    }

    if (oldestUri) {
      logger.info(`Evicting LRU file: ${oldestUri}`);
      this.lspClient.notify('textDocument/didClose', {
        textDocument: { uri: oldestUri }
      });
      this.openFiles.delete(oldestUri);

      // Notify callback
      if (this.onFileClosedCallback) {
        this.onFileClosedCallback(oldestUri);
      }
    }
  }

  /**
   * Open a file in the LSP server via textDocument/didOpen
   */
  private async openFile(uri: string): Promise<void> {
    try {
      const fsPath = uriToPath(uri);
      // Use async readFile to avoid blocking the event loop on large files
      const content = await readFile(fsPath, 'utf-8');

      // Determine language ID from file extension
      const languageId = getLanguageId(fsPath);

      logger.debug('Opening file:', uri);

      this.lspClient.notify('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId,
          version: 1,
          text: content
        }
      });

      this.openFiles.set(uri, Date.now());
      logger.info('Opened file:', uri);
    } catch (error) {
      logger.error('Failed to open file:', uri, error);
      throw new Error(`Failed to open file ${uri}: ${error}`);
    }
  }

  /**
   * Close a file in the LSP server via textDocument/didClose
   */
  closeFile(filePath: string): void {
    const uri = normalizeToUri(filePath);

    if (!this.openFiles.has(uri)) {
      return;
    }

    logger.debug('Closing file:', uri);

    this.lspClient.notify('textDocument/didClose', {
      textDocument: { uri }
    });

    this.openFiles.delete(uri);

    // Notify callback
    if (this.onFileClosedCallback) {
      this.onFileClosedCallback(uri);
    }

    logger.info('Closed file:', uri);
  }

  /**
   * Close all opened files
   */
  closeAll(): void {
    logger.info(`Closing ${this.openFiles.size} opened files`);

    for (const uri of this.openFiles.keys()) {
      this.lspClient.notify('textDocument/didClose', {
        textDocument: { uri }
      });

      // Notify callback for each file
      if (this.onFileClosedCallback) {
        this.onFileClosedCallback(uri);
      }
    }

    this.openFiles.clear();
  }

  /**
   * Get the set of currently opened file URIs
   */
  getOpenFiles(): Set<string> {
    return new Set(this.openFiles.keys());
  }

  /**
   * Check if a file is currently opened
   */
  isFileOpen(filePath: string): boolean {
    const uri = normalizeToUri(filePath);
    return this.openFiles.has(uri);
  }
}

/**
 * Determine the LSP language ID from file extension
 */
function getLanguageId(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'c':
      return 'c';
    case 'cc':
    case 'cpp':
    case 'cxx':
    case 'c++':
      return 'cpp';
    case 'h':
    case 'hh':
    case 'hpp':
    case 'hxx':
    case 'h++':
      return 'cpp'; // Headers are typically C++ in modern codebases
    case 'm':
      return 'objective-c';
    case 'mm':
      return 'objective-cpp';
    default:
      return 'cpp'; // Default to C++
  }
}
