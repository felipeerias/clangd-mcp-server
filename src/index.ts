#!/usr/bin/env node

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { logger } from './utils/logger.js';
import { detectConfiguration } from './config-detector.js';
import { ClangdManager } from './clangd-manager.js';
import { FileTracker } from './file-tracker.js';

import { findDefinition } from './tools/find-definition.js';
import { findReferences } from './tools/find-references.js';
import { getHover } from './tools/get-hover.js';
import { workspaceSymbolSearch } from './tools/workspace-symbol.js';
import { findImplementations } from './tools/find-implementations.js';
import { getDocumentSymbols } from './tools/document-symbols.js';
import { getDiagnostics, DiagnosticsCache } from './tools/get-diagnostics.js';
import { getCallHierarchy } from './tools/get-call-hierarchy.js';
import { getTypeHierarchy } from './tools/get-type-hierarchy.js';

// Global state
let clangdManager: ClangdManager | null = null;
let fileTracker: FileTracker | null = null;
let diagnosticsCache: DiagnosticsCache | null = null;
let initializationPromise: Promise<void> | null = null;
let isShuttingDown: boolean = false;

/**
 * Validate MCP tool arguments
 */
function validateToolArgs(name: string, args: any): void {
  if (!args || typeof args !== 'object') {
    throw new Error('Invalid arguments: must be an object');
  }

  switch (name) {
    case 'find_definition':
    case 'find_references':
    case 'get_hover':
    case 'find_implementations':
      if (typeof args.file_path !== 'string') {
        throw new Error('Invalid file_path: must be a string');
      }
      if (typeof args.line !== 'number' || !Number.isInteger(args.line) || args.line < 0) {
        throw new Error('Invalid line: must be a non-negative integer');
      }
      if (typeof args.column !== 'number' || !Number.isInteger(args.column) || args.column < 0) {
        throw new Error('Invalid column: must be a non-negative integer');
      }
      if (name === 'find_references' && args.include_declaration !== undefined && typeof args.include_declaration !== 'boolean') {
        throw new Error('Invalid include_declaration: must be a boolean');
      }
      break;

    case 'workspace_symbol_search':
      if (typeof args.query !== 'string') {
        throw new Error('Invalid query: must be a string');
      }
      if (args.limit !== undefined && (typeof args.limit !== 'number' || !Number.isInteger(args.limit) || args.limit <= 0)) {
        throw new Error('Invalid limit: must be a positive integer');
      }
      break;

    case 'get_document_symbols':
      if (typeof args.file_path !== 'string') {
        throw new Error('Invalid file_path: must be a string');
      }
      break;

    case 'get_diagnostics':
      if (typeof args.file_path !== 'string') {
        throw new Error('Invalid file_path: must be a string');
      }
      if (args.force_refresh !== undefined && typeof args.force_refresh !== 'boolean') {
        throw new Error('Invalid force_refresh: must be a boolean');
      }
      break;

    case 'get_call_hierarchy':
    case 'get_type_hierarchy':
      if (typeof args.file_path !== 'string') {
        throw new Error('Invalid file_path: must be a string');
      }
      if (typeof args.line !== 'number' || !Number.isInteger(args.line) || args.line < 0) {
        throw new Error('Invalid line: must be a non-negative integer');
      }
      if (typeof args.column !== 'number' || !Number.isInteger(args.column) || args.column < 0) {
        throw new Error('Invalid column: must be a non-negative integer');
      }
      break;

    default:
      // Unknown tool, will be caught by the switch below
      break;
  }
}

/**
 * Initialize clangd (lazy initialization on first query)
 * Uses a lock to prevent concurrent initialization attempts
 */
async function ensureClangdInitialized(): Promise<void> {
  // Check if shutting down
  if (isShuttingDown) {
    throw new Error('Server is shutting down');
  }

  // Fast path: already initialized
  if (clangdManager && clangdManager.isReady()) {
    return;
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization with lock
  initializationPromise = (async () => {
    try {
      logger.info('Initializing clangd...');

      const config = detectConfiguration();
      clangdManager = new ClangdManager(config);
      await clangdManager.start();

      fileTracker = new FileTracker(clangdManager.getClient());

      // Initialize diagnostics cache
      diagnosticsCache = new DiagnosticsCache(clangdManager.getClient());

      // Hook diagnostics cache to file tracker eviction
      fileTracker.onFileClosed((uri) => {
        if (diagnosticsCache) {
          diagnosticsCache.clearForFile(uri);
        }
      });

      logger.info('Clangd initialization complete');
    } finally {
      // Release lock after completion (success or failure)
      initializationPromise = null;
    }
  })();

  return initializationPromise;
}

/**
 * Main server setup
 */
async function main() {
  logger.info('Starting clangd MCP server');

  const server = new Server(
    {
      name: 'clangd-mcp-server',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'find_definition',
          description: 'Find the definition of a symbol at a given location in a file',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'Absolute path to the source file'
              },
              line: {
                type: 'number',
                description: 'Line number (0-indexed)'
              },
              column: {
                type: 'number',
                description: 'Column number (0-indexed)'
              }
            },
            required: ['file_path', 'line', 'column']
          }
        },
        {
          name: 'find_references',
          description: 'Find all references to a symbol at a given location',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'Absolute path to the source file'
              },
              line: {
                type: 'number',
                description: 'Line number (0-indexed)'
              },
              column: {
                type: 'number',
                description: 'Column number (0-indexed)'
              },
              include_declaration: {
                type: 'boolean',
                description: 'Include the declaration in the results (default: true)',
                default: true
              }
            },
            required: ['file_path', 'line', 'column']
          }
        },
        {
          name: 'get_hover',
          description: 'Get hover information (type, documentation) for a symbol at a given location',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'Absolute path to the source file'
              },
              line: {
                type: 'number',
                description: 'Line number (0-indexed)'
              },
              column: {
                type: 'number',
                description: 'Column number (0-indexed)'
              }
            },
            required: ['file_path', 'line', 'column']
          }
        },
        {
          name: 'workspace_symbol_search',
          description: 'Search for symbols across the entire workspace',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query for symbol names'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return (default: 100)',
                default: 100
              }
            },
            required: ['query']
          }
        },
        {
          name: 'find_implementations',
          description: 'Find implementations of an interface or virtual method at a given location',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'Absolute path to the source file'
              },
              line: {
                type: 'number',
                description: 'Line number (0-indexed)'
              },
              column: {
                type: 'number',
                description: 'Column number (0-indexed)'
              }
            },
            required: ['file_path', 'line', 'column']
          }
        },
        {
          name: 'get_document_symbols',
          description: 'Get a hierarchical list of all symbols in a document',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'Absolute path to the source file'
              }
            },
            required: ['file_path']
          }
        },
        {
          name: 'get_diagnostics',
          description: 'Get diagnostics (errors, warnings, notes) for a file',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'Absolute path to the source file'
              },
              force_refresh: {
                type: 'boolean',
                description: 'Force re-parsing of the file to get latest diagnostics (default: false)',
                default: false
              }
            },
            required: ['file_path']
          }
        },
        {
          name: 'get_call_hierarchy',
          description: 'Get call hierarchy showing incoming callers and outgoing callees for a function',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'Absolute path to the source file'
              },
              line: {
                type: 'number',
                description: 'Line number (0-indexed)'
              },
              column: {
                type: 'number',
                description: 'Column number (0-indexed)'
              }
            },
            required: ['file_path', 'line', 'column']
          }
        },
        {
          name: 'get_type_hierarchy',
          description: 'Get type hierarchy showing base classes (supertypes) and derived classes (subtypes)',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'Absolute path to the source file'
              },
              line: {
                type: 'number',
                description: 'Line number (0-indexed)'
              },
              column: {
                type: 'number',
                description: 'Column number (0-indexed)'
              }
            },
            required: ['file_path', 'line', 'column']
          }
        }
      ]
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: args } = request.params;

      if (!args) {
        throw new Error('Missing arguments for tool call');
      }

      // Validate arguments before initialization
      validateToolArgs(name, args);

      // Initialize clangd on first tool call
      await ensureClangdInitialized();

      if (!clangdManager || !fileTracker) {
        throw new Error('Clangd not initialized');
      }

      switch (name) {
        case 'find_definition': {
          const result = await findDefinition(
            clangdManager.getClient(),
            fileTracker,
            args.file_path as string,
            args.line as number,
            args.column as number
          );
          return {
            content: [{ type: 'text', text: result }]
          };
        }

        case 'find_references': {
          const result = await findReferences(
            clangdManager.getClient(),
            fileTracker,
            args.file_path as string,
            args.line as number,
            args.column as number,
            args.include_declaration !== false
          );
          return {
            content: [{ type: 'text', text: result }]
          };
        }

        case 'get_hover': {
          const result = await getHover(
            clangdManager.getClient(),
            fileTracker,
            args.file_path as string,
            args.line as number,
            args.column as number
          );
          return {
            content: [{ type: 'text', text: result }]
          };
        }

        case 'workspace_symbol_search': {
          const result = await workspaceSymbolSearch(
            clangdManager.getClient(),
            args.query as string,
            (args.limit as number) || 100
          );
          return {
            content: [{ type: 'text', text: result }]
          };
        }

        case 'find_implementations': {
          const result = await findImplementations(
            clangdManager.getClient(),
            fileTracker,
            args.file_path as string,
            args.line as number,
            args.column as number
          );
          return {
            content: [{ type: 'text', text: result }]
          };
        }

        case 'get_document_symbols': {
          const result = await getDocumentSymbols(
            clangdManager.getClient(),
            fileTracker,
            args.file_path as string
          );
          return {
            content: [{ type: 'text', text: result }]
          };
        }

        case 'get_diagnostics': {
          if (!diagnosticsCache) {
            throw new Error('Diagnostics cache not initialized');
          }
          const result = await getDiagnostics(
            diagnosticsCache,
            fileTracker,
            args.file_path as string,
            args.force_refresh === true
          );
          return {
            content: [{ type: 'text', text: result }]
          };
        }

        case 'get_call_hierarchy': {
          const result = await getCallHierarchy(
            clangdManager.getClient(),
            fileTracker,
            args.file_path as string,
            args.line as number,
            args.column as number
          );
          return {
            content: [{ type: 'text', text: result }]
          };
        }

        case 'get_type_hierarchy': {
          const result = await getTypeHierarchy(
            clangdManager.getClient(),
            fileTracker,
            args.file_path as string,
            args.line as number,
            args.column as number
          );
          return {
            content: [{ type: 'text', text: result }]
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      logger.error('Tool call failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: true,
              message: error instanceof Error ? error.message : String(error)
            })
          }
        ],
        isError: true
      };
    }
  });

  // Graceful shutdown handler
  const shutdownHandler = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn(`Received ${signal} again, forcing exit`);
      process.exit(1);
    }

    isShuttingDown = true;
    logger.info(`Received ${signal}, shutting down...`);

    try {
      if (fileTracker) {
        fileTracker.closeAll();
      }
      if (clangdManager) {
        await clangdManager.shutdown();
      }
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdownHandler('SIGINT'));
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Clangd MCP server running on stdio');
}

// Run the server
main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
