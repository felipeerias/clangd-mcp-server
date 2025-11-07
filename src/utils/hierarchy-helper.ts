// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { LSPClient } from '../lsp-client.js';
import { Position } from './lsp-types.js';
import { logger } from './logger.js';

/**
 * Generic result for two-phase hierarchy protocols (call/type hierarchy)
 */
export interface HierarchyResult<TItem, TIncoming, TOutgoing> {
  item: TItem;
  incoming: TIncoming[];
  outgoing: TOutgoing[];
}

/**
 * Fetch hierarchy using the two-phase LSP protocol pattern:
 * 1. Prepare: Get the hierarchy item(s) at the position
 * 2. Query: Get incoming/outgoing relationships in parallel
 *
 * This helper abstracts the common pattern used by both call hierarchy and type hierarchy
 */
export async function fetchTwoPhaseHierarchy<TItem, TIncoming, TOutgoing>(
  lspClient: LSPClient,
  prepareMethod: string,
  incomingMethod: string,
  outgoingMethod: string,
  uri: string,
  position: Position
): Promise<HierarchyResult<TItem, TIncoming, TOutgoing> | null> {
  logger.debug(`Fetching hierarchy for ${uri} at ${position.line}:${position.character}`);

  // Phase 1: Prepare - Get hierarchy item(s) at position
  const items = await lspClient.request(prepareMethod, {
    textDocument: { uri },
    position
  });

  // Handle null or empty results
  if (!items || (Array.isArray(items) && items.length === 0)) {
    logger.debug(`No hierarchy items found for ${prepareMethod}`);
    return null;
  }

  // Use first item if multiple are returned (e.g., overloaded functions)
  const item = Array.isArray(items) ? items[0] : items;

  logger.debug(`Found hierarchy item: ${JSON.stringify(item)}`);

  // Phase 2: Query incoming and outgoing relationships in parallel
  const [incoming, outgoing] = await Promise.all([
    lspClient.request(incomingMethod, { item }).catch(error => {
      logger.warn(`${incomingMethod} failed:`, error);
      return null;
    }),
    lspClient.request(outgoingMethod, { item }).catch(error => {
      logger.warn(`${outgoingMethod} failed:`, error);
      return null;
    })
  ]);

  return {
    item,
    incoming: incoming || [],
    outgoing: outgoing || []
  };
}
