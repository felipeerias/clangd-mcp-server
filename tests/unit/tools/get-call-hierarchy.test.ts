// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { getCallHierarchy } from '../../../src/tools/get-call-hierarchy.js';
import { FileTracker } from '../../../src/file-tracker.js';
import { LSPClient } from '../../../src/lsp-client.js';
import { MockWritableStream, MockReadableStream, sendLSPMessage } from '../../helpers/mock-streams.js';
import {
  mockCallHierarchyItem,
  mockCallHierarchyIncomingCalls,
  mockCallHierarchyOutgoingCalls
} from '../../helpers/mock-lsp-responses.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('get-call-hierarchy', () => {
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
    testDir = join(tmpdir(), `call-hierarchy-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    testFile = join(testDir, 'test.cpp');
    writeFileSync(testFile, 'void myFunction() { }');
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

  describe('getCallHierarchy', () => {
    it('should return call hierarchy with incoming and outgoing calls', async () => {
      const promise = getCallHierarchy(client, fileTracker, testFile, 10, 5);

      // Wait for file to be opened
      await new Promise(resolve => setTimeout(resolve, 50));

      // Respond to prepare request
      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: [mockCallHierarchyItem]
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Respond to incoming calls request
      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 2,
        result: mockCallHierarchyIncomingCalls
      });

      // Respond to outgoing calls request
      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 3,
        result: mockCallHierarchyOutgoingCalls
      });

      const result = await promise;
      const parsed = JSON.parse(result);

      expect(parsed.found).toBe(true);
      expect(parsed.symbol.name).toBe('myFunction');
      expect(parsed.symbol.kind).toBe('Function');
      expect(parsed.incoming_calls).toHaveLength(2);
      expect(parsed.outgoing_calls).toHaveLength(1);
      expect(parsed.incoming_count).toBe(2);
      expect(parsed.outgoing_count).toBe(1);
    });

    it('should format incoming calls correctly', async () => {
      const promise = getCallHierarchy(client, fileTracker, testFile, 10, 5);

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: mockCallHierarchyItem
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 2,
        result: mockCallHierarchyIncomingCalls
      });

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 3,
        result: []
      });

      const result = await promise;
      const parsed = JSON.parse(result);

      const firstCaller = parsed.incoming_calls[0];
      expect(firstCaller.caller).toBe('caller1');
      expect(firstCaller.kind).toBe('Function');
      expect(firstCaller.location.file).toBe('/path/to/caller1.cpp');
      expect(firstCaller.location.line).toBe(30);
      expect(firstCaller.location.column).toBe(5);
      expect(firstCaller.call_sites).toHaveLength(1);
      expect(firstCaller.call_sites[0].line).toBe(35);
      expect(firstCaller.call_sites[0].column).toBe(2);
    });

    it('should format outgoing calls correctly', async () => {
      const promise = getCallHierarchy(client, fileTracker, testFile, 10, 5);

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: mockCallHierarchyItem
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
        result: mockCallHierarchyOutgoingCalls
      });

      const result = await promise;
      const parsed = JSON.parse(result);

      const firstCallee = parsed.outgoing_calls[0];
      expect(firstCallee.callee).toBe('callee1');
      expect(firstCallee.kind).toBe('Function');
      expect(firstCallee.location.file).toBe('/path/to/callee1.cpp');
      expect(firstCallee.location.line).toBe(70);
      expect(firstCallee.location.column).toBe(5);
      expect(firstCallee.call_sites).toHaveLength(1);
      expect(firstCallee.call_sites[0].line).toBe(15);
      expect(firstCallee.call_sites[0].column).toBe(2);
    });

    it('should handle no hierarchy available', async () => {
      const promise = getCallHierarchy(client, fileTracker, testFile, 10, 5);

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
      expect(parsed.message).toBe('No call hierarchy available at this position');
    });

    it('should handle empty incoming and outgoing calls', async () => {
      const promise = getCallHierarchy(client, fileTracker, testFile, 10, 5);

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: mockCallHierarchyItem
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
      expect(parsed.incoming_calls).toHaveLength(0);
      expect(parsed.outgoing_calls).toHaveLength(0);
      expect(parsed.incoming_count).toBe(0);
      expect(parsed.outgoing_count).toBe(0);
    });

    it('should include main symbol location', async () => {
      const promise = getCallHierarchy(client, fileTracker, testFile, 10, 5);

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: mockCallHierarchyItem
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

      expect(parsed.symbol.location.file).toBe('/path/to/file.cpp');
      expect(parsed.symbol.location.line).toBe(10);
      expect(parsed.symbol.location.column).toBe(5);
    });

    it('should handle multiple call sites per relationship', async () => {
      const multipleCallSites = [{
        from: {
          name: 'caller',
          kind: 12,
          uri: 'file:///caller.cpp',
          range: { start: { line: 10, character: 0 }, end: { line: 20, character: 1 } },
          selectionRange: { start: { line: 10, character: 5 }, end: { line: 10, character: 11 } }
        },
        fromRanges: [
          { start: { line: 15, character: 2 }, end: { line: 15, character: 12 } },
          { start: { line: 17, character: 2 }, end: { line: 17, character: 12 } },
          { start: { line: 19, character: 2 }, end: { line: 19, character: 12 } }
        ]
      }];

      const promise = getCallHierarchy(client, fileTracker, testFile, 10, 5);

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: mockCallHierarchyItem
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 2,
        result: multipleCallSites
      });

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 3,
        result: []
      });

      const result = await promise;
      const parsed = JSON.parse(result);

      expect(parsed.incoming_calls[0].call_sites).toHaveLength(3);
      expect(parsed.incoming_calls[0].call_sites[0].line).toBe(15);
      expect(parsed.incoming_calls[0].call_sites[1].line).toBe(17);
      expect(parsed.incoming_calls[0].call_sites[2].line).toBe(19);
    });

    it('should handle unknown symbol kinds', async () => {
      const unknownKindItem = {
        ...mockCallHierarchyItem,
        kind: 999 // Unknown kind
      };

      const promise = getCallHierarchy(client, fileTracker, testFile, 10, 5);

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

      expect(parsed.symbol.kind).toBe('Unknown(999)');
    });
  });
});
