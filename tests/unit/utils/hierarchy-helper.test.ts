// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { fetchTwoPhaseHierarchy } from '../../../src/utils/hierarchy-helper.js';
import { LSPClient } from '../../../src/lsp-client.js';
import { MockWritableStream, MockReadableStream, sendLSPMessage } from '../../helpers/mock-streams.js';

describe('hierarchy-helper', () => {
  let client: LSPClient;
  let stdin: MockWritableStream;
  let stdout: MockReadableStream;

  beforeEach(() => {
    stdin = new MockWritableStream();
    stdout = new MockReadableStream();
    client = new LSPClient(stdin, stdout);
  });

  afterEach(() => {
    client.close();
    stdin.cleanup();
    stdout.cleanup();
  });

  describe('fetchTwoPhaseHierarchy', () => {
    it('should fetch hierarchy with single item response', async () => {
      const mockItem = {
        name: 'TestFunction',
        kind: 12,
        uri: 'file:///test.cpp',
        range: { start: { line: 10, character: 0 }, end: { line: 20, character: 1 } },
        selectionRange: { start: { line: 10, character: 5 }, end: { line: 10, character: 17 } }
      };

      const mockIncoming = [
        { from: { name: 'caller', kind: 12 }, fromRanges: [] }
      ];

      const mockOutgoing = [
        { to: { name: 'callee', kind: 12 }, fromRanges: [] }
      ];

      // Start the request
      const promise = fetchTwoPhaseHierarchy(
        client,
        'textDocument/prepareCallHierarchy',
        'callHierarchy/incomingCalls',
        'callHierarchy/outgoingCalls',
        'file:///test.cpp',
        { line: 10, character: 5 }
      );

      // Wait a bit for request to be sent
      await new Promise(resolve => setTimeout(resolve, 10));

      // Respond to prepare request
      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: mockItem
      });

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      // Respond to incoming and outgoing requests
      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 2,
        result: mockIncoming
      });

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 3,
        result: mockOutgoing
      });

      const result = await promise;

      expect(result).toBeDefined();
      expect(result?.item).toEqual(mockItem);
      expect(result?.incoming).toEqual(mockIncoming);
      expect(result?.outgoing).toEqual(mockOutgoing);
    });

    it('should handle array response from prepare phase', async () => {
      const mockItems = [
        {
          name: 'TestFunction1',
          kind: 12,
          uri: 'file:///test.cpp',
          range: { start: { line: 10, character: 0 }, end: { line: 20, character: 1 } },
          selectionRange: { start: { line: 10, character: 5 }, end: { line: 10, character: 18 } }
        },
        {
          name: 'TestFunction2',
          kind: 12,
          uri: 'file:///test.cpp',
          range: { start: { line: 30, character: 0 }, end: { line: 40, character: 1 } },
          selectionRange: { start: { line: 30, character: 5 }, end: { line: 30, character: 18 } }
        }
      ];

      // Start the request
      const promise = fetchTwoPhaseHierarchy(
        client,
        'textDocument/prepareCallHierarchy',
        'callHierarchy/incomingCalls',
        'callHierarchy/outgoingCalls',
        'file:///test.cpp',
        { line: 10, character: 5 }
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      // Respond with array (should use first item)
      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: mockItems
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Respond to incoming and outgoing
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

      expect(result).toBeDefined();
      // Should use first item from array
      expect(result?.item).toEqual(mockItems[0]);
    });

    it('should return null when prepare phase returns null', async () => {
      const promise = fetchTwoPhaseHierarchy(
        client,
        'textDocument/prepareCallHierarchy',
        'callHierarchy/incomingCalls',
        'callHierarchy/outgoingCalls',
        'file:///test.cpp',
        { line: 10, character: 5 }
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: null
      });

      const result = await promise;

      expect(result).toBeNull();
    });

    it('should return null when prepare phase returns empty array', async () => {
      const promise = fetchTwoPhaseHierarchy(
        client,
        'textDocument/prepareCallHierarchy',
        'callHierarchy/incomingCalls',
        'callHierarchy/outgoingCalls',
        'file:///test.cpp',
        { line: 10, character: 5 }
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: []
      });

      const result = await promise;

      expect(result).toBeNull();
    });

    it('should handle errors in incoming call request gracefully', async () => {
      const mockItem = {
        name: 'TestFunction',
        kind: 12,
        uri: 'file:///test.cpp',
        range: { start: { line: 10, character: 0 }, end: { line: 20, character: 1 } },
        selectionRange: { start: { line: 10, character: 5 }, end: { line: 10, character: 17 } }
      };

      const promise = fetchTwoPhaseHierarchy(
        client,
        'textDocument/prepareCallHierarchy',
        'callHierarchy/incomingCalls',
        'callHierarchy/outgoingCalls',
        'file:///test.cpp',
        { line: 10, character: 5 }
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: mockItem
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Respond with error for incoming
      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 2,
        error: {
          code: -32603,
          message: 'Internal error'
        }
      });

      // Success for outgoing
      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 3,
        result: []
      });

      const result = await promise;

      expect(result).toBeDefined();
      expect(result?.item).toEqual(mockItem);
      expect(result?.incoming).toEqual([]); // Should be empty array on error
      expect(result?.outgoing).toEqual([]);
    });

    it('should handle errors in outgoing call request gracefully', async () => {
      const mockItem = {
        name: 'TestFunction',
        kind: 12,
        uri: 'file:///test.cpp',
        range: { start: { line: 10, character: 0 }, end: { line: 20, character: 1 } },
        selectionRange: { start: { line: 10, character: 5 }, end: { line: 10, character: 17 } }
      };

      const promise = fetchTwoPhaseHierarchy(
        client,
        'textDocument/prepareCallHierarchy',
        'callHierarchy/incomingCalls',
        'callHierarchy/outgoingCalls',
        'file:///test.cpp',
        { line: 10, character: 5 }
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: mockItem
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Success for incoming
      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 2,
        result: []
      });

      // Error for outgoing
      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 3,
        error: {
          code: -32603,
          message: 'Internal error'
        }
      });

      const result = await promise;

      expect(result).toBeDefined();
      expect(result?.item).toEqual(mockItem);
      expect(result?.incoming).toEqual([]);
      expect(result?.outgoing).toEqual([]); // Should be empty array on error
    });

    it('should handle null results for incoming/outgoing gracefully', async () => {
      const mockItem = {
        name: 'TestFunction',
        kind: 12,
        uri: 'file:///test.cpp',
        range: { start: { line: 10, character: 0 }, end: { line: 20, character: 1 } },
        selectionRange: { start: { line: 10, character: 5 }, end: { line: 10, character: 17 } }
      };

      const promise = fetchTwoPhaseHierarchy(
        client,
        'textDocument/prepareCallHierarchy',
        'callHierarchy/incomingCalls',
        'callHierarchy/outgoingCalls',
        'file:///test.cpp',
        { line: 10, character: 5 }
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 1,
        result: mockItem
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Null results
      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 2,
        result: null
      });

      sendLSPMessage(stdout, {
        jsonrpc: '2.0',
        id: 3,
        result: null
      });

      const result = await promise;

      expect(result).toBeDefined();
      expect(result?.item).toEqual(mockItem);
      expect(result?.incoming).toEqual([]);
      expect(result?.outgoing).toEqual([]);
    });
  });
});
