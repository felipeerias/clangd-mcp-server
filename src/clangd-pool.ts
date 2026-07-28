// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { logger } from './utils/logger.js';
import { ClangdManager } from './clangd-manager.js';
import { FileTracker } from './file-tracker.js';
import { DiagnosticsCache } from './tools/get-diagnostics.js';
import { LSPClient } from './lsp-client.js';
import { buildInstanceConfig, WorkspaceConfig } from './config-detector.js';
import {
  CompilationDatabase,
  CompilationDatabaseResolver,
  findDatabaseInDirectory,
  normalizePathKey,
} from './compilation-database.js';

export interface ClangdSession {
  /** Stable identity of this session: the database directory, or the root. */
  key: string;
  projectRoot: string;
  database?: CompilationDatabase;
  manager: ClangdManager;
  fileTracker: FileTracker;
  diagnosticsCache: DiagnosticsCache;
  lastUsed: number;
}

/**
 * Runs one clangd instance per compilation database.
 *
 * Multi-root workspaces routinely mix several projects that each ship their own
 * compile_commands.json with different include paths and defines. A single
 * clangd pinned to one --compile-commands-dir answers correctly only for the
 * project it was pointed at, so requests are instead routed to the instance
 * that owns the file's database, started on demand.
 */
export class ClangdPool {
  private sessions: Map<string, ClangdSession> = new Map();
  private starting: Map<string, Promise<ClangdSession>> = new Map();
  private resolver: CompilationDatabaseResolver;
  private shuttingDown: boolean = false;

  constructor(private workspace: WorkspaceConfig) {
    const fallback = this.findFallbackDatabase();
    this.resolver = new CompilationDatabaseResolver(workspace.explicitDatabaseDir, fallback);
  }

  /** First root that actually has a database; used for files outside any project. */
  private findFallbackDatabase(): CompilationDatabase | undefined {
    for (const root of this.workspace.projectRoots) {
      const database = findDatabaseInDirectory(root);
      if (database) {
        return database;
      }
    }
    return undefined;
  }

  /** Session that owns `filePath`, starting clangd for it if needed. */
  async getSessionForFile(filePath: string): Promise<ClangdSession> {
    const database = this.resolver.resolveForFile(filePath);
    const projectRoot = database?.projectRoot ?? this.workspace.projectRoots[0];
    return this.acquire(this.sessionKey(projectRoot, database), projectRoot, database);
  }

  /**
   * Sessions to consult for workspace-wide queries.
   *
   * Background indexing is off by default, so clangd answers workspace/symbol
   * from the files it currently has open. Only running sessions can therefore
   * contribute results, and starting extra instances would add cost without
   * widening the search. One session is started only if none exist yet.
   */
  async getSessionsForWorkspace(): Promise<ClangdSession[]> {
    if (this.sessions.size > 0) {
      const live = [...this.sessions.values()];
      for (const session of live) {
        session.lastUsed = Date.now();
      }
      return live;
    }

    const root = this.workspace.projectRoots[0];
    const database = this.workspace.explicitDatabaseDir
      ? this.resolver.resolveForFile(root)
      : findDatabaseInDirectory(root);

    return [await this.acquire(this.sessionKey(database?.projectRoot ?? root, database), database?.projectRoot ?? root, database)];
  }

  /** Snapshot of resolved databases and which of them are currently running. */
  describe(): object {
    const running = new Set(this.sessions.keys());

    const projects = this.workspace.projectRoots.map(root => {
      const database = this.workspace.explicitDatabaseDir
        ? this.resolver.resolveForFile(root)
        : findDatabaseInDirectory(root);
      return {
        project_root: root,
        compile_commands: database?.path ?? null,
        clangd_running: running.has(this.sessionKey(database?.projectRoot ?? root, database)),
      };
    });

    return {
      clangd_path: this.workspace.clangdPath,
      base_args: this.workspace.baseArgs,
      explicit_compile_commands_dir: this.workspace.explicitDatabaseDir ?? null,
      max_instances: this.workspace.maxInstances,
      running_instances: this.sessions.size,
      project_count: projects.length,
      projects,
    };
  }

  async shutdownAll(): Promise<void> {
    this.shuttingDown = true;
    const sessions = [...this.sessions.values()];
    this.sessions.clear();

    await Promise.all(
      sessions.map(async session => {
        try {
          session.fileTracker.closeAll();
          await session.manager.shutdown();
        } catch (error) {
          logger.error(`Error shutting down clangd for ${session.key}:`, error);
        }
      })
    );
  }

  private sessionKey(projectRoot: string, database?: CompilationDatabase): string {
    return database ? `db:${normalizePathKey(database.directory)}` : `root:${normalizePathKey(projectRoot)}`;
  }

  /** Return a ready session for `key`, starting or awaiting one as needed. */
  private async acquire(
    key: string,
    projectRoot: string,
    database?: CompilationDatabase
  ): Promise<ClangdSession> {
    if (this.shuttingDown) {
      throw new Error('Server is shutting down');
    }

    const existing = this.sessions.get(key);
    if (existing) {
      if (existing.manager.isReady()) {
        existing.lastUsed = Date.now();
        return existing;
      }
      // Crashed beyond its restart budget; replace it.
      this.sessions.delete(key);
    }

    const inFlight = this.starting.get(key);
    if (inFlight) {
      return inFlight;
    }

    const startup = this.start(key, projectRoot, database).finally(() => {
      this.starting.delete(key);
    });
    this.starting.set(key, startup);
    return startup;
  }

  private async start(
    key: string,
    projectRoot: string,
    database?: CompilationDatabase
  ): Promise<ClangdSession> {
    await this.evictIfNeeded();

    logger.info(
      `Starting clangd for ${projectRoot} ` +
        `(database: ${database?.path ?? 'none - clangd will infer commands'})`
    );

    const manager = new ClangdManager(buildInstanceConfig(this.workspace, projectRoot, database));
    await manager.start();

    const fileTracker = new FileTracker(manager.getClient());
    const diagnosticsCache = new DiagnosticsCache(manager.getClient());
    fileTracker.onFileClosed(uri => diagnosticsCache.clearForFile(uri));

    const session: ClangdSession = {
      key,
      projectRoot,
      database,
      manager,
      fileTracker,
      diagnosticsCache,
      lastUsed: Date.now(),
    };

    this.sessions.set(key, session);
    logger.info(`clangd ready for ${projectRoot} (${this.sessions.size}/${this.workspace.maxInstances} instances)`);
    return session;
  }

  /** Retire the least recently used session so a new one can start. */
  private async evictIfNeeded(): Promise<void> {
    while (this.sessions.size >= this.workspace.maxInstances) {
      let oldest: ClangdSession | undefined;
      for (const session of this.sessions.values()) {
        if (!oldest || session.lastUsed < oldest.lastUsed) {
          oldest = session;
        }
      }
      if (!oldest) {
        return;
      }

      logger.info(`Evicting least recently used clangd instance: ${oldest.projectRoot}`);
      this.sessions.delete(oldest.key);
      try {
        oldest.fileTracker.closeAll();
        await oldest.manager.shutdown();
      } catch (error) {
        logger.warn(`Error evicting clangd for ${oldest.key}:`, error);
      }
    }
  }
}

/** Convenience accessor used by tools that only need the LSP client. */
export function clientOf(session: ClangdSession): LSPClient {
  return session.manager.getClient();
}
