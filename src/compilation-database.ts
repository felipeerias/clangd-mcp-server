// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { logger } from './utils/logger.js';

export interface CompilationDatabase {
  /** Directory handed to clangd via --compile-commands-dir */
  directory: string;
  /** Absolute path of the compile_commands.json file */
  path: string;
  /** Directory whose subtree this database serves; used as the LSP root */
  projectRoot: string;
}

/**
 * Locations probed inside every candidate directory.
 * The first two mirror clangd's own discovery; the rest cover generators that
 * keep the database in a build output directory (CMake presets, GN/Chromium).
 */
const DATABASE_SEARCH_PATHS = [
  '.',
  'build',
  'out/Default',
  'out/Release',
  'out/Debug',
  '.build',
];

/** Case-insensitive on Windows so cache keys and paths compare consistently. */
export function normalizePathKey(path: string): string {
  return process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
}

/**
 * Look for a compilation database directly inside a single directory.
 * Does not walk ancestors.
 */
export function findDatabaseInDirectory(directory: string): CompilationDatabase | undefined {
  for (const relative of DATABASE_SEARCH_PATHS) {
    const candidate = join(directory, relative, 'compile_commands.json');
    if (existsSync(candidate)) {
      return {
        directory: dirname(candidate),
        path: candidate,
        projectRoot: directory,
      };
    }
  }
  return undefined;
}

/**
 * Resolves which compilation database applies to a given source file.
 *
 * A single workspace commonly contains several independent projects, each with
 * its own compile_commands.json. Rather than forcing one database for the whole
 * server, every file is matched against the nearest database found by walking
 * its ancestor directories - a superset of clangd's own discovery rules.
 */
export class CompilationDatabaseResolver {
  /** Maps a directory to the database that serves it. Only hits are cached. */
  private cache: Map<string, CompilationDatabase> = new Map();
  private explicit?: CompilationDatabase;
  private fallback?: CompilationDatabase;

  constructor(explicitDirectory?: string, fallback?: CompilationDatabase) {
    if (explicitDirectory) {
      const path = join(resolve(explicitDirectory), 'compile_commands.json');
      if (existsSync(path)) {
        this.explicit = { directory: resolve(explicitDirectory), path, projectRoot: resolve(explicitDirectory) };
        logger.info('Using explicit compilation database:', path);
      } else {
        logger.warn('COMPILE_COMMANDS_DIR has no compile_commands.json:', explicitDirectory);
      }
    }
    this.fallback = fallback;
  }

  /** Database used when a file has no database anywhere above it. */
  setFallback(fallback?: CompilationDatabase): void {
    this.fallback = fallback;
  }

  /**
   * Find the database that governs `filePath`, walking up from its directory.
   * Returns undefined when neither an ancestor nor the fallback provides one,
   * in which case clangd applies its own heuristics.
   */
  resolveForFile(filePath: string): CompilationDatabase | undefined {
    if (this.explicit) {
      return this.explicit;
    }

    const absolute = resolve(filePath);
    let directory: string;
    try {
      directory = statSync(absolute).isDirectory() ? absolute : dirname(absolute);
    } catch {
      directory = dirname(absolute);
    }

    const visited: string[] = [];
    let current = directory;

    for (;;) {
      const key = normalizePathKey(current);
      const cached = this.cache.get(key);
      if (cached) {
        // Drop entries whose database was deleted since it was cached.
        if (existsSync(cached.path)) {
          this.memoize(visited, cached);
          return cached;
        }
        this.cache.delete(key);
      }

      const found = findDatabaseInDirectory(current);
      if (found) {
        this.cache.set(key, found);
        this.memoize(visited, found);
        logger.debug(`Compilation database for ${absolute}: ${found.path}`);
        return found;
      }

      visited.push(current);
      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }

    if (this.fallback) {
      logger.debug(`No ancestor database for ${absolute}, using fallback ${this.fallback.path}`);
    } else {
      logger.warn(`No compilation database found for ${absolute}`);
    }
    return this.fallback;
  }

  private memoize(directories: string[], database: CompilationDatabase): void {
    for (const directory of directories) {
      this.cache.set(normalizePathKey(directory), database);
    }
  }
}
