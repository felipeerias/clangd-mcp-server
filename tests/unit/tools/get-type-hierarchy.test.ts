// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { getTypeHierarchy } from '../../../src/tools/get-type-hierarchy.js';
import { FileTracker } from '../../../src/file-tracker.js';
import { LSPClient } from '../../../src/lsp-client.js';
import { MockWritableStream, MockReadableStream, sendLSPMessage } from '../../helpers/mock-streams.js';
import {
  mockTypeHierarchyItem,
  mockTypeHierarchySupertypes,
  mockTypeHierarchySubtypes
} from '../../helpers/mock-lsp-responses.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('get-type-hierarchy', () => {
  let client: LSPClient;
  let fileTracker: FileTracker;
  let stdin: MockWritableStream;
  let stdout: MockReadableStream;
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    stdin = new MockWritableStream();
    stdout = new MockReadableStream();
    client = new LSPClient(stdin, stdout);
    fileTracker = new FileTracker(client);

    // Create temp test file
    testDir = join(tmpdir(), `type-hierarchy-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    testFile = join(testDir, 'test.cpp');
    writeFileSync(testFile, 'class DerivedClass { };');
  });

  afterEach(() => {
    fileTracker.closeAll();
    client.close();
    stdin.cleanup();
    stdout.cleanup();
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('getTypeHierarchy', () => {
    it('should return type hierarchy with supertypes and subtypes', async () => {
      const promise = getTypeHierarchy(client, fileTracker, testFile, 10, 6);

      // Wait for file to be opened
      await new Promise(resolve => setTimeout(resolve, 50));

      // Respond to prepare request
      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: [mockTypeHierarchyItem]
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Respond to supertypes request
      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 2,
        result: mockTypeHierarchySupertypes
      });

      // Respond to subtypes request
      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 3,
        result: mockTypeHierarchySubtypes
      });

      const result = await promise;
      const parsed = JSON.parse(result);

      expect(parsed.found).toBe(true);
      expect(parsed.type.name).toBe('DerivedClass');
      expect(parsed.type.kind).toBe('Class');
      expect(parsed.supertypes).toHaveLength(2);
      expect(parsed.subtypes).toHaveLength(1);
      expect(parsed.supertypes_count).toBe(2);
      expect(parsed.subtypes_count).toBe(1);
    });

    it('should format supertypes correctly', async () => {
      const promise = getTypeHierarchy(client, fileTracker, testFile, 10, 6);

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: mockTypeHierarchyItem
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 2,
        result: mockTypeHierarchySupertypes
      });

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 3,
        result: []
      });

      const result = await promise;
      const parsed = JSON.parse(result);

      const firstSupertype = parsed.supertypes[0];
      expect(firstSupertype.name).toBe('BaseClass');
      expect(firstSupertype.kind).toBe('Class');
      expect(firstSupertype.location.file).toBe('/path/to/base.cpp');
      expect(firstSupertype.location.line).toBe(5);
      expect(firstSupertype.location.column).toBe(6);

      const secondSupertype = parsed.supertypes[1];
      expect(secondSupertype.name).toBe('Interface');
      expect(secondSupertype.kind).toBe('Interface');
    });

    it('should format subtypes correctly', async () => {
      const promise = getTypeHierarchy(client, fileTracker, testFile, 10, 6);

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: mockTypeHierarchyItem
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 2,
        result: []
      });

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 3,
        result: mockTypeHierarchySubtypes
      });

      const result = await promise;
      const parsed = JSON.parse(result);

      const firstSubtype = parsed.subtypes[0];
      expect(firstSubtype.name).toBe('ConcreteClass');
      expect(firstSubtype.kind).toBe('Class');
      expect(firstSubtype.location.file).toBe('/path/to/concrete.cpp');
      expect(firstSubtype.location.line).toBe(20);
      expect(firstSubtype.location.column).toBe(6);
    });

    it('should handle no hierarchy available', async () => {
      const promise = getTypeHierarchy(client, fileTracker, testFile, 10, 6);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Return null from prepare (no hierarchy at this position)
      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: null
      });

      const result = await promise;
      const parsed = JSON.parse(result);

      expect(parsed.found).toBe(false);
      expect(parsed.message).toBe('No type hierarchy available at this position');
    });

    it('should handle empty supertypes and subtypes', async () => {
      const promise = getTypeHierarchy(client, fileTracker, testFile, 10, 6);

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: mockTypeHierarchyItem
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 2,
        result: []
      });

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 3,
        result: []
      });

      const result = await promise;
      const parsed = JSON.parse(result);

      expect(parsed.found).toBe(true);
      expect(parsed.supertypes).toHaveLength(0);
      expect(parsed.subtypes).toHaveLength(0);
      expect(parsed.supertypes_count).toBe(0);
      expect(parsed.subtypes_count).toBe(0);
    });

    it('should include main type location', async () => {
      const promise = getTypeHierarchy(client, fileTracker, testFile, 10, 6);

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: mockTypeHierarchyItem
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 2,
        result: []
      });

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 3,
        result: []
      });

      const result = await promise;
      const parsed = JSON.parse(result);

      expect(parsed.type.location.file).toBe('/path/to/derived.cpp');
      expect(parsed.type.location.line).toBe(10);
      expect(parsed.type.location.column).toBe(6);
    });

    it('should handle class with only base classes (no subtypes)', async () => {
      const promise = getTypeHierarchy(client, fileTracker, testFile, 10, 6);

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: mockTypeHierarchyItem
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 2,
        result: mockTypeHierarchySupertypes
      });

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 3,
        result: []
      });

      const result = await promise;
      const parsed = JSON.parse(result);

      expect(parsed.supertypes).toHaveLength(2);
      expect(parsed.subtypes).toHaveLength(0);
    });

    it('should handle base class with only derived classes (no supertypes)', async () => {
      const promise = getTypeHierarchy(client, fileTracker, testFile, 10, 6);

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: mockTypeHierarchyItem
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 2,
        result: []
      });

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 3,
        result: mockTypeHierarchySubtypes
      });

      const result = await promise;
      const parsed = JSON.parse(result);

      expect(parsed.supertypes).toHaveLength(0);
      expect(parsed.subtypes).toHaveLength(1);
    });

    it('should handle multiple inheritance', async () => {
      const multipleSupertypes = [
        {
          name: 'BaseClass1',
          kind: 5,
          uri: 'file:///base1.cpp',
          range: { start: { line: 5, character: 0 }, end: { line: 10, character: 1 } },
          selectionRange: { start: { line: 5, character: 6 }, end: { line: 5, character: 16 } }
        },
        {
          name: 'BaseClass2',
          kind: 5,
          uri: 'file:///base2.cpp',
          range: { start: { line: 5, character: 0 }, end: { line: 10, character: 1 } },
          selectionRange: { start: { line: 5, character: 6 }, end: { line: 5, character: 16 } }
        },
        {
          name: 'BaseClass3',
          kind: 5,
          uri: 'file:///base3.cpp',
          range: { start: { line: 5, character: 0 }, end: { line: 10, character: 1 } },
          selectionRange: { start: { line: 5, character: 6 }, end: { line: 5, character: 16 } }
        }
      ];

      const promise = getTypeHierarchy(client, fileTracker, testFile, 10, 6);

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: mockTypeHierarchyItem
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 2,
        result: multipleSupertypes
      });

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 3,
        result: []
      });

      const result = await promise;
      const parsed = JSON.parse(result);

      expect(parsed.supertypes).toHaveLength(3);
      expect(parsed.supertypes[0].name).toBe('BaseClass1');
      expect(parsed.supertypes[1].name).toBe('BaseClass2');
      expect(parsed.supertypes[2].name).toBe('BaseClass3');
    });

    it('should handle unknown symbol kinds', async () => {
      const unknownKindItem = {
        ...mockTypeHierarchyItem,
        kind: 999 // Unknown kind
      };

      const promise = getTypeHierarchy(client, fileTracker, testFile, 10, 6);

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: unknownKindItem
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 2,
        result: []
      });

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 3,
        result: []
      });

      const result = await promise;
      const parsed = JSON.parse(result);

      expect(parsed.type.kind).toBe('Unknown(999)');
    });
  });
});
