// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * A workspace with two sibling projects that each own a compilation database,
 * plus a third project whose database lives in build/.
 */
function createWorkspace(root: string) {
  const alpha = join(root, 'alpha');
  const beta = join(root, 'beta');
  const gamma = join(root, 'gamma');

  mkdirSync(join(alpha, 'src'), { recursive: true });
  mkdirSync(join(beta, 'src', 'nested'), { recursive: true });
  mkdirSync(join(gamma, 'build'), { recursive: true });
  mkdirSync(join(gamma, 'src'), { recursive: true });

  writeFileSync(join(alpha, 'compile_commands.json'), '[]');
  writeFileSync(join(beta, 'compile_commands.json'), '[]');
  writeFileSync(join(gamma, 'build', 'compile_commands.json'), '[]');

  writeFileSync(join(alpha, 'src', 'a.cpp'), 'int a() { return 1; }\n');
  writeFileSync(join(beta, 'src', 'nested', 'b.cpp'), 'int b() { return 2; }\n');
  writeFileSync(join(gamma, 'src', 'c.cpp'), 'int c() { return 3; }\n');

  return { alpha, beta, gamma };
}

describe('Compilation database resolution', () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    testDir = join(tmpdir(), `clangd-mcp-multi-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    originalEnv = { ...process.env };
    delete process.env.PROJECT_ROOT;
    delete process.env.PROJECT_ROOTS;
    delete process.env.WORKSPACE_FILE;
    delete process.env.COMPILE_COMMANDS_DIR;
    delete process.env.CLANGD_MAX_INSTANCES;

    jest.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('routes each file to the database of its own project', async () => {
    const { alpha, beta } = createWorkspace(testDir);
    const { CompilationDatabaseResolver } = await import('../../src/compilation-database.js');
    const resolver = new CompilationDatabaseResolver();

    const forAlpha = resolver.resolveForFile(join(alpha, 'src', 'a.cpp'));
    const forBeta = resolver.resolveForFile(join(beta, 'src', 'nested', 'b.cpp'));

    expect(forAlpha?.path).toBe(join(alpha, 'compile_commands.json'));
    expect(forBeta?.path).toBe(join(beta, 'compile_commands.json'));
    expect(forAlpha?.directory).not.toBe(forBeta?.directory);
  });

  it('finds a database that lives in a build directory', async () => {
    const { gamma } = createWorkspace(testDir);
    const { CompilationDatabaseResolver } = await import('../../src/compilation-database.js');
    const resolver = new CompilationDatabaseResolver();

    const resolved = resolver.resolveForFile(join(gamma, 'src', 'c.cpp'));

    expect(resolved?.path).toBe(join(gamma, 'build', 'compile_commands.json'));
    expect(resolved?.directory).toBe(join(gamma, 'build'));
    // The project root stays the project, not the build output directory.
    expect(resolved?.projectRoot).toBe(gamma);
  });

  it('walks up to the nearest ancestor database', async () => {
    const outer = join(testDir, 'outer');
    const inner = join(outer, 'inner', 'deep');
    mkdirSync(inner, { recursive: true });
    writeFileSync(join(outer, 'compile_commands.json'), '[]');
    writeFileSync(join(inner, 'd.cpp'), 'int d();\n');

    const { CompilationDatabaseResolver } = await import('../../src/compilation-database.js');
    const resolver = new CompilationDatabaseResolver();

    expect(resolver.resolveForFile(join(inner, 'd.cpp'))?.path).toBe(join(outer, 'compile_commands.json'));
  });

  it('prefers a nested database over an ancestor one', async () => {
    const outer = join(testDir, 'outer');
    const inner = join(outer, 'inner');
    mkdirSync(inner, { recursive: true });
    writeFileSync(join(outer, 'compile_commands.json'), '[]');
    writeFileSync(join(inner, 'compile_commands.json'), '[]');
    writeFileSync(join(inner, 'e.cpp'), 'int e();\n');

    const { CompilationDatabaseResolver } = await import('../../src/compilation-database.js');
    const resolver = new CompilationDatabaseResolver();

    expect(resolver.resolveForFile(join(inner, 'e.cpp'))?.path).toBe(join(inner, 'compile_commands.json'));
  });

  it('uses the fallback database when no ancestor has one', async () => {
    const { alpha } = createWorkspace(testDir);
    const orphanDir = join(tmpdir(), `clangd-mcp-orphan-${Date.now()}`);
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, 'orphan.cpp'), 'int o();\n');

    try {
      const { CompilationDatabaseResolver, findDatabaseInDirectory } = await import(
        '../../src/compilation-database.js'
      );
      const resolver = new CompilationDatabaseResolver(undefined, findDatabaseInDirectory(alpha));

      expect(resolver.resolveForFile(join(orphanDir, 'orphan.cpp'))?.path).toBe(
        join(alpha, 'compile_commands.json')
      );
    } finally {
      rmSync(orphanDir, { recursive: true, force: true });
    }
  });

  it('honours COMPILE_COMMANDS_DIR for every file', async () => {
    const { alpha, beta } = createWorkspace(testDir);
    const { CompilationDatabaseResolver } = await import('../../src/compilation-database.js');
    const resolver = new CompilationDatabaseResolver(beta);

    // alpha has its own database, but the explicit override wins.
    expect(resolver.resolveForFile(join(alpha, 'src', 'a.cpp'))?.directory).toBe(beta);
  });
});

describe('Multi-root workspace detection', () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    testDir = join(tmpdir(), `clangd-mcp-roots-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    originalEnv = { ...process.env };
    delete process.env.PROJECT_ROOT;
    delete process.env.PROJECT_ROOTS;
    delete process.env.WORKSPACE_FILE;
    delete process.env.COMPILE_COMMANDS_DIR;
    delete process.env.CLANGD_MAX_INSTANCES;

    jest.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('reads roots from PROJECT_ROOTS', async () => {
    const { alpha, beta } = createWorkspace(testDir);
    process.env.PROJECT_ROOTS = `${alpha};${beta}`;
    jest.resetModules();

    const { detectProjectRoots } = await import('../../src/config-detector.js');

    expect(detectProjectRoots()).toEqual([alpha, beta]);
  });

  it('reads roots from a .code-workspace file, including comments', async () => {
    const { alpha, beta, gamma } = createWorkspace(testDir);
    const workspaceFile = join(testDir, 'test.code-workspace');
    writeFileSync(
      workspaceFile,
      `{
        // a multi-root workspace
        "folders": [
          { "name": "alpha", "path": "alpha" },
          { "path": ${JSON.stringify(beta)} },
          /* relative paths resolve against the workspace file */
          { "path": "gamma" }
        ]
      }`
    );
    process.env.WORKSPACE_FILE = workspaceFile;
    jest.resetModules();

    const { detectProjectRoots } = await import('../../src/config-detector.js');

    expect(detectProjectRoots()).toEqual([alpha, beta, gamma]);
  });

  it('drops duplicate and non-existent roots', async () => {
    const { alpha } = createWorkspace(testDir);
    process.env.PROJECT_ROOT = alpha;
    process.env.PROJECT_ROOTS = `${alpha};${join(testDir, 'does-not-exist')}`;
    jest.resetModules();

    const { detectProjectRoots } = await import('../../src/config-detector.js');

    expect(detectProjectRoots()).toEqual([alpha]);
  });

  it('falls back to the working directory when nothing is configured', async () => {
    const originalCwd = process.cwd();
    process.chdir(testDir);
    jest.resetModules();

    try {
      const { detectProjectRoots } = await import('../../src/config-detector.js');
      const roots = detectProjectRoots();
      expect(roots).toHaveLength(1);
      // macOS reports /var and /private/var for the same directory.
      expect(roots[0].endsWith(testDir) || testDir.endsWith(roots[0])).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('builds per-instance args that pin clangd to one database', async () => {
    const { alpha, beta } = createWorkspace(testDir);
    process.env.PROJECT_ROOTS = `${alpha};${beta}`;
    process.env.CLANGD_PATH = 'clangd';
    jest.resetModules();

    const { detectWorkspaceConfiguration, buildInstanceConfig } = await import(
      '../../src/config-detector.js'
    );
    const { findDatabaseInDirectory } = await import('../../src/compilation-database.js');

    const workspace = detectWorkspaceConfiguration();
    expect(workspace.projectRoots).toEqual([alpha, beta]);
    expect(workspace.baseArgs.some(arg => arg.startsWith('--compile-commands-dir'))).toBe(false);

    const alphaConfig = buildInstanceConfig(workspace, alpha, findDatabaseInDirectory(alpha));
    const betaConfig = buildInstanceConfig(workspace, beta, findDatabaseInDirectory(beta));

    expect(alphaConfig.clangdArgs).toContain(`--compile-commands-dir=${alpha}`);
    expect(betaConfig.clangdArgs).toContain(`--compile-commands-dir=${beta}`);
    expect(alphaConfig.projectRoot).toBe(alpha);
    expect(betaConfig.projectRoot).toBe(beta);
  });

  it('omits --compile-commands-dir when a project has no database', async () => {
    const bare = join(testDir, 'bare');
    mkdirSync(bare, { recursive: true });
    process.env.PROJECT_ROOTS = bare;
    process.env.CLANGD_PATH = 'clangd';
    jest.resetModules();

    const { detectWorkspaceConfiguration, buildInstanceConfig } = await import(
      '../../src/config-detector.js'
    );

    const config = buildInstanceConfig(detectWorkspaceConfiguration(), bare, undefined);

    expect(config.clangdArgs.some(arg => arg.startsWith('--compile-commands-dir'))).toBe(false);
    expect(config.compileCommandsPath).toBeUndefined();
  });
});
