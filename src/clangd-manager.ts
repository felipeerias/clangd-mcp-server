// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { spawn, ChildProcess } from 'node:child_process';
import { logger } from './utils/logger.js';
import { ClangdError } from './utils/errors.js';
import { LSPClient } from './lsp-client.js';
import { ClangdConfig } from './config-detector.js';
import { pathToUri } from './utils/uri.js';

interface InitializeResult {
  capabilities: any;
  serverInfo?: {
    name: string;
    version?: string;
  };
}

export class ClangdManager {
  private config: ClangdConfig;
  private process?: ChildProcess;
  private lspClient?: LSPClient;
  private initialized: boolean = false;
  private shuttingDown: boolean = false;
  private restartCount: number = 0;
  private readonly maxRestarts: number = 3;
  private isRestarting: boolean = false;
  private lastSuccessfulStart: number = 0;
  private readonly stableOperationPeriodMs: number = 60000; // 1 minute

  constructor(config: ClangdConfig) {
    this.config = config;
  }

  /**
   * Start clangd and initialize the LSP connection
   */
  async start(): Promise<void> {
    if (this.process) {
      logger.warn('Clangd already running');
      return;
    }

    try {
      await this.spawnClangd();
      await this.initialize();
      this.initialized = true;

      // Reset restart count if we've had a stable operation period
      if (this.restartCount > 0) {
        const timeSinceLastStart = Date.now() - this.lastSuccessfulStart;
        if (timeSinceLastStart >= this.stableOperationPeriodMs) {
          logger.info('Stable operation detected, resetting restart counter');
          this.restartCount = 0;
        }
      }

      this.lastSuccessfulStart = Date.now();

      logger.info('Clangd started and initialized successfully');
    } catch (error) {
      logger.error('Failed to start clangd:', error);
      await this.cleanup();
      throw new ClangdError('Failed to start clangd: ' + error);
    }
  }

  /**
   * Spawn the clangd process
   */
  private async spawnClangd(): Promise<void> {
    logger.info('Spawning clangd:', this.config.clangdPath, this.config.clangdArgs);

    this.process = spawn(this.config.clangdPath, this.config.clangdArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.config.projectRoot
    });

    if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
      throw new ClangdError('Failed to create clangd stdio streams');
    }

    // Create LSP client
    this.lspClient = new LSPClient(this.process.stdin, this.process.stdout);

    // Handle process events
    this.process.on('error', (error) => {
      logger.error('Clangd process error:', error);
    });

    this.process.on('exit', (code, signal) => {
      logger.warn(`Clangd process exited with code ${code}, signal ${signal}`);
      this.handleProcessExit(code, signal);
    });

    // Log stderr output
    this.process.stderr.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        logger.debug('Clangd stderr:', message);
      }
    });

    // Give the process a moment to start
    await new Promise(resolve => setTimeout(resolve, 100));

    if (!this.process || this.process.exitCode !== null) {
      throw new ClangdError('Clangd process failed to start');
    }
  }

  /**
   * Initialize the LSP connection with clangd
   */
  private async initialize(): Promise<void> {
    if (!this.lspClient) {
      throw new ClangdError('LSP client not created');
    }

    logger.info('Initializing LSP connection');

    const initializeParams = {
      processId: process.pid,
      clientInfo: {
        name: 'clangd-mcp-server',
        version: '0.1.0'
      },
      // pathToUri produces a well-formed URI on every platform. Naive string
      // concatenation yields `file://C:\dir`, which clangd rejects on Windows.
      rootUri: pathToUri(this.config.projectRoot),
      capabilities: {
        textDocument: {
          definition: { linkSupport: true },
          references: {},
          hover: { contentFormat: ['markdown', 'plaintext'] },
          implementation: { linkSupport: true },
          documentSymbol: {
            hierarchicalDocumentSymbolSupport: true
          }
        },
        workspace: {
          symbol: {}
        }
      },
      initializationOptions: {}
    };

    try {
      const result: InitializeResult = await this.lspClient.request(
        'initialize',
        initializeParams,
        30000
      );

      logger.info('LSP initialized:', result.serverInfo);

      // Send initialized notification
      this.lspClient.notify('initialized', {});

      logger.info('LSP initialization complete');
    } catch (error) {
      throw new ClangdError('LSP initialization failed: ' + error);
    }
  }

  /**
   * Handle clangd process exit
   */
  private handleProcessExit(code: number | null, signal: string | null): void {
    if (this.shuttingDown) {
      logger.info('Clangd shut down gracefully');
      return;
    }

    logger.error('Clangd crashed unexpectedly');

    // Clean up current state
    this.process = undefined;
    this.lspClient = undefined;
    this.initialized = false;

    // Prevent concurrent restart attempts
    if (this.isRestarting) {
      logger.warn('Restart already in progress, ignoring duplicate crash');
      return;
    }

    // Reset restart count if we've had stable operation
    const timeSinceLastStart = Date.now() - this.lastSuccessfulStart;
    if (timeSinceLastStart >= this.stableOperationPeriodMs && this.restartCount > 0) {
      logger.info('Stable operation period elapsed, resetting restart counter');
      this.restartCount = 0;
    }

    // Attempt restart if under limit
    if (this.restartCount < this.maxRestarts) {
      this.restartCount++;
      this.isRestarting = true;
      logger.warn(`Attempting to restart clangd (attempt ${this.restartCount}/${this.maxRestarts})`);

      setTimeout(() => {
        this.start()
          .then(() => {
            this.isRestarting = false;
            logger.info('Clangd restarted successfully');
          })
          .catch((error) => {
            this.isRestarting = false;
            logger.error('Failed to restart clangd:', error);
          });
      }, 1000 * this.restartCount); // Exponential backoff
    } else {
      logger.error('Max restart attempts reached, giving up');
    }
  }

  /**
   * Gracefully shutdown clangd
   */
  async shutdown(): Promise<void> {
    if (!this.process || this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;
    logger.info('Shutting down clangd');

    try {
      if (this.lspClient && this.initialized) {
        // Send shutdown request
        await this.lspClient.request('shutdown', undefined, 5000);
        // Send exit notification
        this.lspClient.notify('exit');
      }

      // Wait a bit for graceful exit
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      logger.warn('Error during graceful shutdown:', error);
    }

    await this.cleanup();
  }

  /**
   * Force cleanup of clangd resources
   */
  private async cleanup(): Promise<void> {
    if (this.lspClient) {
      this.lspClient.close();
      this.lspClient = undefined;
    }

    if (this.process && this.process.exitCode === null) {
      logger.info('Killing clangd process');
      this.process.kill('SIGTERM');

      // Force kill after timeout
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (this.process && this.process.exitCode === null) {
        logger.warn('Force killing clangd process');
        this.process.kill('SIGKILL');
      }
    }

    this.process = undefined;
    this.initialized = false;

    // Reset flags only if not shutting down (cleanup during restart vs shutdown)
    if (!this.shuttingDown) {
      this.isRestarting = false;
    }
  }

  /**
   * Get the LSP client
   */
  getClient(): LSPClient {
    if (!this.lspClient || !this.initialized) {
      throw new ClangdError('Clangd not initialized');
    }
    return this.lspClient;
  }

  /**
   * Check if clangd is running and initialized
   */
  isReady(): boolean {
    return this.initialized && !!this.process && this.process.exitCode === null;
  }

  /**
   * Configuration this instance was started with
   */
  getConfig(): ClangdConfig {
    return this.config;
  }
}
