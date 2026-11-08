// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Readable, Writable } from 'node:stream';
import { logger } from './utils/logger.js';
import { LSPError, withTimeout } from './utils/errors.js';

interface JsonRpcMessage {
  jsonrpc: '2.0';
}

interface JsonRpcRequest extends JsonRpcMessage {
  id: number | string;
  method: string;
  params?: any;
}

interface JsonRpcResponse extends JsonRpcMessage {
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

interface JsonRpcNotification extends JsonRpcMessage {
  method: string;
  params?: any;
}

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: any) => void;
};

export class LSPClient {
  private stdin: Writable;
  private stdout: Readable;
  private nextId: number = 1;
  private pendingRequests: Map<number | string, PendingRequest> = new Map();
  // 修改原因：LSP 的 Content-Length 是**字节数**，原实现用 string 累加并按字符
  // 下标切分。当响应含多字节 UTF-8（如 hover 的 markdown 内容）时，
  // messageEnd = start + 字节数 > 字符串长度，substring 会越过本条消息
  // 吞进下一条 → "Unexpected non-whitespace character after JSON"，
  // 表现为 get_hover 永久超时（30s LSP 超时 + 60s 上层超时）。
  // 改为 Buffer 累加 + 按字节切分，同时避免 chunk 边界截断多字节字符。
  // 修改日期：2026-11-07
  private buffer: Buffer = Buffer.alloc(0);
  private notificationHandlers: Map<string, (params: any) => void> = new Map();
  private readonly maxMessageSize: number = 100 * 1024 * 1024; // 100 MB limit
  private dataHandler?: (chunk: Buffer) => void;
  private errorHandler?: (error: Error) => void;
  private endHandler?: () => void;

  constructor(stdin: Writable, stdout: Readable) {
    this.stdin = stdin;
    this.stdout = stdout;
    this.setupStreamHandlers();
  }

  private setupStreamHandlers(): void {
    this.dataHandler = (chunk: Buffer) => {
      // 修改原因：见 buffer 字段注释（按字节累加，避免多字节字符被 chunk 边界切断）。
      // 修改日期：2026-11-07
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processBuffer();
    };

    this.errorHandler = (error: Error) => {
      logger.error('LSP stdout error:', error);
    };

    this.endHandler = () => {
      logger.info('LSP stdout ended');
      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests.entries()) {
        pending.reject(new Error('LSP connection closed'));
      }
      this.pendingRequests.clear();
    };

    this.stdout.on('data', this.dataHandler);
    this.stdout.on('error', this.errorHandler);
    this.stdout.on('end', this.endHandler);
  }

  private processBuffer(): void {
    while (true) {
      // 修改原因：全程在 Buffer 上按字节解析（见 buffer 字段注释）。
      // 修改日期：2026-11-07
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        break;
      }

      const headerText = this.buffer.subarray(0, headerEnd).toString('latin1');
      const headerMatch = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!headerMatch) {
        // 缺 Content-Length 的头视为畸形，丢弃该段继续
        logger.error('Missing Content-Length header, skipping malformed block');
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(headerMatch[1], 10);

      // Check for malformed or malicious message size
      if (contentLength > this.maxMessageSize) {
        logger.error(`Message size ${contentLength} exceeds maximum ${this.maxMessageSize}, dropping connection`);
        this.close();
        return;
      }

      if (contentLength < 0 || !Number.isFinite(contentLength)) {
        logger.error(`Invalid Content-Length: ${contentLength}, skipping message`);
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }

      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      if (this.buffer.length < messageEnd) {
        // Not enough data yet
        break;
      }

      const messageText = this.buffer.subarray(messageStart, messageEnd).toString('utf8');
      this.buffer = this.buffer.subarray(messageEnd);

      try {
        const message = JSON.parse(messageText);
        this.handleMessage(message);
      } catch (error) {
        logger.error('Failed to parse LSP message:', error);
      }
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if ('id' in message && ('result' in message || 'error' in message)) {
      // Response
      this.handleResponse(message as JsonRpcResponse);
    } else if ('method' in message && !('id' in message)) {
      // Notification
      this.handleNotification(message as JsonRpcNotification);
    } else {
      logger.warn('Unknown message type:', message);
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      logger.warn('Received response for unknown request:', response.id);
      return;
    }

    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(new LSPError(
        response.error.message,
        response.error.code,
        response.error.data
      ));
    } else {
      pending.resolve(response.result);
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    logger.debug('Received notification:', notification.method);

    const handler = this.notificationHandlers.get(notification.method);
    if (handler) {
      try {
        handler(notification.params);
      } catch (error) {
        logger.error('Error in notification handler:', error);
      }
    }
  }

  /**
   * Register a handler for a specific notification method
   */
  onNotification(method: string, handler: (params: any) => void): void {
    this.notificationHandlers.set(method, handler);
  }

  /**
   * Send a request and wait for the response
   */
  async request(method: string, params?: any, timeoutMs: number = 30000): Promise<any> {
    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    const promise = new Promise<any>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });

    this.sendMessage(request);

    try {
      return await withTimeout(promise, timeoutMs, `LSP request '${method}' timed out after ${timeoutMs}ms`);
    } catch (error) {
      this.pendingRequests.delete(id);
      throw error;
    }
  }

  /**
   * Send a notification (no response expected)
   */
  notify(method: string, params?: any): void {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params
    };

    this.sendMessage(notification);
  }

  private sendMessage(message: JsonRpcMessage): void {
    const content = JSON.stringify(message);
    const contentLength = Buffer.byteLength(content, 'utf-8');
    const header = `Content-Length: ${contentLength}\r\n\r\n`;
    const fullMessage = header + content;

    logger.debug('Sending LSP message:', message);

    // Handle backpressure: if write returns false, wait for drain
    const canWrite = this.stdin.write(fullMessage);
    if (!canWrite) {
      logger.warn('LSP stdin buffer full, backpressure detected');
      // In future, could queue messages or apply backpressure to callers
      // For now, just log the warning as the stream will handle buffering
    }
  }

  /**
   * Remove event listeners from stdout stream
   */
  private cleanup(): void {
    if (this.dataHandler) {
      this.stdout.off('data', this.dataHandler);
    }
    if (this.errorHandler) {
      this.stdout.off('error', this.errorHandler);
    }
    if (this.endHandler) {
      this.stdout.off('end', this.endHandler);
    }
  }

  /**
   * Close the LSP client
   */
  close(): void {
    this.cleanup();
    this.stdin.end();
  }
}
