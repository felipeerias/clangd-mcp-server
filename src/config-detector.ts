// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { logger } from './utils/logger.js';
import { CompilationDatabase, findDatabaseInDirectory, normalizePathKey } from './compilation-database.js';

export interface ClangdConfig {
  clangdPath: string;
  clangdArgs: string[];
  projectRoot: string;
  compileCommandsPath?: string;
  isChromiumProject: boolean;
}

/**
 * Workspace-wide settings shared by every clangd instance.
 *
 * A workspace may hold several independent projects, so the compilation
 * database is intentionally not part of this object: it is resolved per file
 * and folded into a per-instance ClangdConfig by buildInstanceConfig().
 */
export interface WorkspaceConfig {
  clangdPath: string;
  /** Arguments common to all instances; excludes --compile-commands-dir. */
  baseArgs: string[];
  /** Project roots, most specific first. Always contains at least one entry. */
  projectRoots: string[];
  /** COMPILE_COMMANDS_DIR override, applied to every file when set. */
  explicitDatabaseDir?: string;
  /** Upper bound on concurrently running clangd instances. */
  maxInstances: number;
  isChromiumProject: boolean;
}

const DEFAULT_MAX_INSTANCES = 8;

/**
 * Detect if project is a Chromium project by checking for bundled clangd
 * Only consider it a Chromium project if the bundled clangd exists,
 * since that's what we need for Chromium-specific behavior
 */
function detectChromiumProject(projectRoot: string): boolean {
  const chromiumClangdPaths = [
    'third_party/llvm-build/Release+Asserts/bin/clangd',
    'third_party/llvm-build/Release/bin/clangd',
  ];

  return chromiumClangdPaths.some(path =>
    existsSync(join(projectRoot, path))
  );
}

/**
 * Get clangd version string
 */
function getClangdVersion(clangdPath: string): string | undefined {
  try {
    const result = spawnSync(clangdPath, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
    });

    if (result.status === 0 && result.stdout) {
      // Extract version from output like "clangd version 18.1.3" or "clangd version 22.0.0git"
      const match = result.stdout.match(/clangd version ([\d.]+\w*)/);
      if (match) {
        return match[1];
      }
    }
  } catch (error) {
    logger.debug('Failed to get clangd version:', error);
  }
  return undefined;
}

/**
 * Find project's bundled clangd binary
 * Currently supports auto-detection for Chromium projects
 */
function findProjectBundledClangd(projectRoot: string, isChromiumProject: boolean): string | undefined {
  // Auto-detect Chromium bundled clangd
  if (isChromiumProject) {
    const searchPaths = [
      'third_party/llvm-build/Release+Asserts/bin/clangd',
      'third_party/llvm-build/Release/bin/clangd',
    ];

    for (const searchPath of searchPaths) {
      const fullPath = join(projectRoot, searchPath);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }
  }

  return undefined;
}

/**
 * Resolve the clangd binary to use, preferring an explicit override, then a
 * project-bundled binary, then whatever is on PATH.
 */
function resolveClangdPath(projectRoot: string, isChromiumProject: boolean): string {
  let clangdPath: string;
  let projectClangd: string | undefined;

  if (process.env.CLANGD_PATH) {
    clangdPath = process.env.CLANGD_PATH;
    logger.info('Using clangd from CLANGD_PATH:', clangdPath);
  } else {
    projectClangd = findProjectBundledClangd(projectRoot, isChromiumProject);
    if (projectClangd) {
      clangdPath = projectClangd;
      logger.info('Using Chromium bundled clangd:', clangdPath);
    } else if (isChromiumProject) {
      clangdPath = 'clangd';
      logger.warn('Chromium project detected but bundled clangd not found, falling back to system clangd');
      logger.warn('Consider setting CLANGD_PATH to third_party/llvm-build/Release+Asserts/bin/clangd');
    } else {
      clangdPath = 'clangd';
      logger.info('Using system clangd from PATH');
    }
  }

  // Detect and log clangd version
  const version = getClangdVersion(clangdPath);
  if (version) {
    logger.info(`Clangd version: ${version}`);

    // Warn if using old system clangd for Chromium
    if (isChromiumProject && !projectClangd) {
      const majorVersion = parseInt(version.split('.')[0]);
      if (majorVersion < 20) {
        logger.warn(`Using older system clangd (${version}) for Chromium project. Consider using the bundled clangd (v22+) via CLANGD_PATH`);
      }
    }
  } else {
    logger.warn('Could not detect clangd version');
  }

  return clangdPath;
}

/**
 * Detect project configuration and generate appropriate clangd settings
 */
export function detectConfiguration(): ClangdConfig {
  // Get project root from environment or use cwd
  const projectRoot = resolve(process.env.PROJECT_ROOT || process.cwd());
  logger.info('Project root:', projectRoot);

  // Check if this is a Chromium project using multiple detection strategies
  const isChromiumProject = detectChromiumProject(projectRoot);
  if (isChromiumProject) {
    logger.info('Detected Chromium project');
  }

  const clangdPath = resolveClangdPath(projectRoot, isChromiumProject);

  // Find compile_commands.json
  const compileCommandsPath = findCompileCommands(projectRoot);
  if (compileCommandsPath) {
    logger.info('Found compile_commands.json at:', compileCommandsPath);
  } else {
    logger.warn('compile_commands.json not found - clangd may not work correctly');
  }

  // Generate clangd arguments
  const clangdArgs = generateClangdArgs(isChromiumProject, compileCommandsPath);
  logger.info('Clangd arguments:', clangdArgs.join(' '));

  return {
    clangdPath,
    clangdArgs,
    projectRoot,
    compileCommandsPath,
    isChromiumProject
  };
}

/**
 * Search for compile_commands.json in standard locations
 */
function findCompileCommands(projectRoot: string): string | undefined {
  // Check explicit environment variable first
  if (process.env.COMPILE_COMMANDS_DIR) {
    const explicitPath = resolve(process.env.COMPILE_COMMANDS_DIR, 'compile_commands.json');
    if (existsSync(explicitPath)) {
      return explicitPath;
    }
  }

  const database = findDatabaseInDirectory(projectRoot);
  return database?.path;
}

/**
 * Strip // and /* *\/ comments so VS Code .code-workspace files (JSONC) parse.
 * Comment markers inside string literals are preserved.
 */
function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        out += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    out += char;
  }

  return out;
}

/**
 * Read the folder list out of a VS Code .code-workspace file.
 * Relative folder paths are resolved against the workspace file's directory.
 */
export function readWorkspaceFileFolders(workspaceFile: string): string[] {
  const absolute = resolve(workspaceFile);
  if (!existsSync(absolute)) {
    logger.warn('WORKSPACE_FILE does not exist:', absolute);
    return [];
  }

  try {
    const parsed = JSON.parse(stripJsonComments(readFileSync(absolute, 'utf-8')));
    const folders = Array.isArray(parsed?.folders) ? parsed.folders : [];
    const base = dirname(absolute);

    return folders
      .map((folder: any) => (typeof folder?.path === 'string' ? folder.path : undefined))
      .filter((path: string | undefined): path is string => Boolean(path))
      .map((path: string) => (isAbsolute(path) ? resolve(path) : resolve(base, path)));
  } catch (error) {
    logger.warn(`Failed to read workspace file ${absolute}:`, error);
    return [];
  }
}

/** Split a user-supplied path list. ';' works everywhere; ':' is POSIX-only. */
function splitPathList(value: string): string[] {
  const separator = process.platform === 'win32' ? /;/ : /[;:]/;
  return value
    .split(separator)
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
}

/**
 * Collect the project roots this server should serve, in priority order:
 * PROJECT_ROOT, then PROJECT_ROOTS, then the folders of WORKSPACE_FILE,
 * falling back to the current working directory.
 */
export function detectProjectRoots(): string[] {
  const candidates: string[] = [];

  if (process.env.PROJECT_ROOT) {
    candidates.push(resolve(process.env.PROJECT_ROOT));
  }
  if (process.env.PROJECT_ROOTS) {
    candidates.push(...splitPathList(process.env.PROJECT_ROOTS).map(entry => resolve(entry)));
  }
  if (process.env.WORKSPACE_FILE) {
    candidates.push(...readWorkspaceFileFolders(process.env.WORKSPACE_FILE));
  }
  if (candidates.length === 0) {
    candidates.push(resolve(process.cwd()));
  }

  const seen = new Set<string>();
  const roots: string[] = [];

  for (const candidate of candidates) {
    const key = normalizePathKey(candidate);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    try {
      if (!statSync(candidate).isDirectory()) {
        logger.warn('Ignoring project root that is not a directory:', candidate);
        continue;
      }
    } catch {
      logger.warn('Ignoring project root that does not exist:', candidate);
      continue;
    }

    roots.push(candidate);
  }

  // Every candidate was invalid; cwd keeps the server usable.
  return roots.length > 0 ? roots : [resolve(process.cwd())];
}

/**
 * Detect workspace-wide configuration shared by all clangd instances.
 */
export function detectWorkspaceConfiguration(): WorkspaceConfig {
  const projectRoots = detectProjectRoots();
  logger.info(`Project roots (${projectRoots.length}):`, projectRoots.join(', '));

  const primaryRoot = projectRoots[0];
  const isChromiumProject = projectRoots.some(root => detectChromiumProject(root));
  if (isChromiumProject) {
    logger.info('Detected Chromium project');
  }

  const clangdPath = resolveClangdPath(primaryRoot, isChromiumProject);
  const maxInstances = readMaxInstances();

  return {
    clangdPath,
    baseArgs: generateClangdArgs(isChromiumProject),
    projectRoots,
    explicitDatabaseDir: process.env.COMPILE_COMMANDS_DIR
      ? resolve(process.env.COMPILE_COMMANDS_DIR)
      : undefined,
    maxInstances,
    isChromiumProject,
  };
}

function readMaxInstances(): number {
  const raw = process.env.CLANGD_MAX_INSTANCES;
  if (!raw) {
    return DEFAULT_MAX_INSTANCES;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    logger.warn(`Invalid CLANGD_MAX_INSTANCES '${raw}', using ${DEFAULT_MAX_INSTANCES}`);
    return DEFAULT_MAX_INSTANCES;
  }
  return parsed;
}

/**
 * Build the configuration for one clangd instance bound to a single database.
 */
export function buildInstanceConfig(
  workspace: WorkspaceConfig,
  projectRoot: string,
  database?: CompilationDatabase
): ClangdConfig {
  const clangdArgs = [...workspace.baseArgs];
  if (database) {
    clangdArgs.unshift(`--compile-commands-dir=${database.directory}`);
  }

  return {
    clangdPath: workspace.clangdPath,
    clangdArgs,
    projectRoot,
    compileCommandsPath: database?.path,
    isChromiumProject: workspace.isChromiumProject,
  };
}

/**
 * Parse shell arguments handling quotes and escapes
 */
function parseShellArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && (inDoubleQuote || !inSingleQuote)) {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

/**
 * Generate appropriate clangd arguments based on project type
 */
function generateClangdArgs(isChromiumProject: boolean, compileCommandsPath?: string): string[] {
  const args: string[] = [];

  // Parse additional args from environment
  if (process.env.CLANGD_ARGS) {
    args.push(...parseShellArgs(process.env.CLANGD_ARGS));
  }

  // Add compile commands path if found
  if (compileCommandsPath) {
    // Use dirname to properly extract directory on all platforms
    args.push(`--compile-commands-dir=${dirname(compileCommandsPath)}`);
  }

  // Disable background indexing by default for MCP server use case
  // MCP servers make sporadic queries, not continuous editing, so on-demand
  // indexing (via didOpen) is more efficient. Users can override via CLANGD_ARGS.
  if (!args.some(arg => arg.startsWith('--background-index'))) {
    args.push('--background-index=false');
  }

  // For Chromium projects, suggest remote index server
  if (isChromiumProject) {
    if (!args.some(arg => arg.startsWith('--remote-index-address'))) {
      logger.info('Consider setting up a remote index server for better performance on Chromium');
    }
  }

  // Limit results for all queries
  if (!args.some(arg => arg.startsWith('--limit-references'))) {
    args.push('--limit-references=1000');
  }

  if (!args.some(arg => arg.startsWith('--limit-results'))) {
    args.push('--limit-results=1000');
  }

  // Enable malloc trim for long-running instances.
  // Not supported on Windows: clangd there rejects the flag and exits with code 1.
  if (process.platform !== 'win32' && !args.some(arg => arg.includes('malloc-trim'))) {
    args.push('--malloc-trim');
  }

  // Improve performance
  if (!args.some(arg => arg.startsWith('--pch-storage'))) {
    args.push('--pch-storage=memory');
  }

  if (!args.some(arg => arg.startsWith('--clang-tidy'))) {
    args.push('--clang-tidy=false'); // Disable for performance
  }

  // Log level
  if (!args.some(arg => arg.startsWith('--log'))) {
    const logLevel = process.env.CLANGD_LOG_LEVEL || 'error';
    args.push(`--log=${logLevel}`);
  }

  return args;
}
