// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Config detector', () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Create temp test directory
    testDir = join(tmpdir(), `clangd-mcp-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Save original environment
    originalEnv = { ...process.env };

    // Clear relevant env vars
    delete process.env.PROJECT_ROOT;
    delete process.env.COMPILE_COMMANDS_DIR;
    delete process.env.CLANGD_PATH;
    delete process.env.CLANGD_ARGS;
    delete process.env.CLANGD_LOG_LEVEL;

    // Reset modules to pick up env changes
    jest.resetModules();
  });

  afterEach(() => {
    // Restore environment
    process.env = { ...originalEnv };

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should use PROJECT_ROOT from environment', async () => {
    process.env.PROJECT_ROOT = testDir;
    jest.resetModules();
    const { detectConfiguration } = await import('../../src/config-detector.js');

    const config = detectConfiguration();
    expect(config.projectRoot).toBe(testDir);
  });

  it('should fallback to cwd when PROJECT_ROOT not set', async () => {
    const originalCwd = process.cwd();
    process.chdir(testDir);
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.projectRoot).toBe(testDir);
    process.chdir(originalCwd);
  });

  it('should detect Chromium project with bundled clangd', async () => {
    // Create bundled clangd
    const clangdDir = join(testDir, 'third_party', 'llvm-build', 'Release+Asserts', 'bin');
    mkdirSync(clangdDir, { recursive: true });
    writeFileSync(join(clangdDir, 'clangd'), '#!/bin/bash\necho clangd');

    process.env.PROJECT_ROOT = testDir;
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.isChromiumProject).toBe(true);
  });

  it('should not detect Chromium project without bundled clangd', async () => {
    process.env.PROJECT_ROOT = testDir;
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.isChromiumProject).toBe(false);
  });

  it('should find compile_commands.json in root', async () => {
    writeFileSync(join(testDir, 'compile_commands.json'), '[]');
    process.env.PROJECT_ROOT = testDir;
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.compileCommandsPath).toBe(join(testDir, 'compile_commands.json'));
  });

  it('should find compile_commands.json in build/', async () => {
    const buildDir = join(testDir, 'build');
    mkdirSync(buildDir);
    writeFileSync(join(buildDir, 'compile_commands.json'), '[]');
    process.env.PROJECT_ROOT = testDir;
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.compileCommandsPath).toBe(join(buildDir, 'compile_commands.json'));
  });

  it('should find compile_commands.json in out/Default/', async () => {
    const outDir = join(testDir, 'out', 'Default');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'compile_commands.json'), '[]');
    process.env.PROJECT_ROOT = testDir;
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.compileCommandsPath).toBe(join(outDir, 'compile_commands.json'));
  });

  it('should respect COMPILE_COMMANDS_DIR environment variable', async () => {
    const customDir = join(testDir, 'custom');
    mkdirSync(customDir);
    writeFileSync(join(customDir, 'compile_commands.json'), '[]');
    process.env.PROJECT_ROOT = testDir;
    process.env.COMPILE_COMMANDS_DIR = customDir;
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.compileCommandsPath).toBe(join(customDir, 'compile_commands.json'));
  });

  it('should return undefined when compile_commands.json not found', async () => {
    process.env.PROJECT_ROOT = testDir;
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.compileCommandsPath).toBeUndefined();
  });

  it('should use CLANGD_PATH from environment', async () => {
    process.env.PROJECT_ROOT = testDir;
    process.env.CLANGD_PATH = '/custom/path/to/clangd';
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.clangdPath).toBe('/custom/path/to/clangd');
  });

  it('should default to "clangd" when CLANGD_PATH not set', async () => {
    process.env.PROJECT_ROOT = testDir;
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.clangdPath).toBe('clangd');
  });

  it('should parse CLANGD_ARGS from environment', async () => {
    process.env.PROJECT_ROOT = testDir;
    process.env.CLANGD_ARGS = '--arg1 --arg2=value';
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.clangdArgs).toContain('--arg1');
    expect(config.clangdArgs).toContain('--arg2=value');
  });

  it('should add --compile-commands-dir when compile_commands.json found', async () => {
    const buildDir = join(testDir, 'build');
    mkdirSync(buildDir);
    writeFileSync(join(buildDir, 'compile_commands.json'), '[]');
    process.env.PROJECT_ROOT = testDir;
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    const compileCommandsArg = config.clangdArgs.find((arg) =>
      arg.startsWith('--compile-commands-dir=')
    );
    expect(compileCommandsArg).toBeDefined();
    expect(compileCommandsArg).toContain(buildDir);
  });

  it('should disable background indexing by default', async () => {
    process.env.PROJECT_ROOT = testDir;
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.clangdArgs).toContain('--background-index=false');
  });

  it('should not override explicit background-index setting', async () => {
    process.env.PROJECT_ROOT = testDir;
    process.env.CLANGD_ARGS = '--background-index=true';
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.clangdArgs).toContain('--background-index=true');
    expect(config.clangdArgs).not.toContain('--background-index=false');
  });

  it('should add default result limits', async () => {
    process.env.PROJECT_ROOT = testDir;
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.clangdArgs).toContain('--limit-references=1000');
    expect(config.clangdArgs).toContain('--limit-results=1000');
  });

  it('should add performance optimizations', async () => {
    process.env.PROJECT_ROOT = testDir;
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.clangdArgs).toContain('--malloc-trim');
    expect(config.clangdArgs).toContain('--pch-storage=memory');
    expect(config.clangdArgs).toContain('--clang-tidy=false');
  });

  it('should use CLANGD_LOG_LEVEL for log argument', async () => {
    process.env.PROJECT_ROOT = testDir;
    process.env.CLANGD_LOG_LEVEL = 'verbose';
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.clangdArgs).toContain('--log=verbose');
  });

  it('should default to error log level', async () => {
    process.env.PROJECT_ROOT = testDir;
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    const logArg = config.clangdArgs.find((arg) => arg.startsWith('--log='));
    expect(logArg).toBe('--log=error');
  });

  it('should use Chromium bundled clangd when available', async () => {
    // Create Chromium project with bundled clangd
    const clangdDir = join(testDir, 'third_party', 'llvm-build', 'Release+Asserts', 'bin');
    mkdirSync(clangdDir, { recursive: true });
    const chromiumClangd = join(clangdDir, 'clangd');
    writeFileSync(chromiumClangd, '#!/bin/bash\necho clangd');

    process.env.PROJECT_ROOT = testDir;
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.isChromiumProject).toBe(true);
    expect(config.clangdPath).toBe(chromiumClangd);
  });

  it('should use system clangd when bundled clangd not found', async () => {
    // No bundled clangd present
    process.env.PROJECT_ROOT = testDir;
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.isChromiumProject).toBe(false);
    expect(config.clangdPath).toBe('clangd');
  });

  it('should prefer CLANGD_PATH over Chromium bundled clangd', async () => {
    // Create Chromium project with bundled clangd
    const clangdDir = join(testDir, 'third_party', 'llvm-build', 'Release+Asserts', 'bin');
    mkdirSync(clangdDir, { recursive: true });
    writeFileSync(join(clangdDir, 'clangd'), '#!/bin/bash\necho clangd');

    process.env.PROJECT_ROOT = testDir;
    process.env.CLANGD_PATH = '/custom/clangd';
    jest.resetModules();

    const { detectConfiguration } = await import('../../src/config-detector.js');
    const config = detectConfiguration();

    expect(config.isChromiumProject).toBe(true);
    expect(config.clangdPath).toBe('/custom/clangd');
  });

  describe('Chromium detection', () => {
    it('should detect Chromium via bundled clangd', async () => {
      // Create only the bundled clangd
      const clangdDir = join(testDir, 'third_party', 'llvm-build', 'Release+Asserts', 'bin');
      mkdirSync(clangdDir, { recursive: true });
      writeFileSync(join(clangdDir, 'clangd'), '#!/bin/bash\necho clangd');

      process.env.PROJECT_ROOT = testDir;
      jest.resetModules();

      const { detectConfiguration } = await import('../../src/config-detector.js');
      const config = detectConfiguration();

      expect(config.isChromiumProject).toBe(true);
    });

    it('should detect Chromium with bundled clangd in src/ subdirectory', async () => {
      // Simulate real Chromium checkout with bundled clangd in src/
      const srcDir = join(testDir, 'chromium', 'src');
      mkdirSync(srcDir, { recursive: true });

      // Add bundled clangd
      const clangdDir = join(srcDir, 'third_party', 'llvm-build', 'Release+Asserts', 'bin');
      mkdirSync(clangdDir, { recursive: true });
      writeFileSync(join(clangdDir, 'clangd'), '#!/bin/bash\necho clangd');

      // Open workspace in src/ directory (common case)
      process.env.PROJECT_ROOT = srcDir;
      jest.resetModules();

      const { detectConfiguration } = await import('../../src/config-detector.js');
      const config = detectConfiguration();

      expect(config.isChromiumProject).toBe(true);
      expect(config.clangdPath).toBe(join(clangdDir, 'clangd'));
    });

    it('should not detect Chromium without bundled clangd', async () => {
      // Create Chromium-like structure but without bundled clangd
      const dirs = ['base', 'chrome', 'content', 'third_party', 'tools/clang'];
      for (const dir of dirs) {
        mkdirSync(join(testDir, dir), { recursive: true });
      }

      process.env.PROJECT_ROOT = testDir;
      jest.resetModules();

      const { detectConfiguration } = await import('../../src/config-detector.js');
      const config = detectConfiguration();

      expect(config.isChromiumProject).toBe(false);
    });
  });
});
