// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/**
 * Shared LSP type definitions and utilities used across tool implementations
 */

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

/**
 * LSP SymbolKind enumeration mapped to human-readable names
 * Reference: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#symbolKind
 */
export const symbolKindNames: Record<number, string> = {
  1: 'File',
  2: 'Module',
  3: 'Namespace',
  4: 'Package',
  5: 'Class',
  6: 'Method',
  7: 'Property',
  8: 'Field',
  9: 'Constructor',
  10: 'Enum',
  11: 'Interface',
  12: 'Function',
  13: 'Variable',
  14: 'Constant',
  15: 'String',
  16: 'Number',
  17: 'Boolean',
  18: 'Array',
  19: 'Object',
  20: 'Key',
  21: 'Null',
  22: 'EnumMember',
  23: 'Struct',
  24: 'Event',
  25: 'Operator',
  26: 'TypeParameter'
};

/**
 * LSP DiagnosticSeverity enumeration
 */
export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4
}

/**
 * Related location information for diagnostics
 */
export interface DiagnosticRelatedInformation {
  location: Location;
  message: string;
}

/**
 * LSP Diagnostic type
 */
export interface Diagnostic {
  range: Range;
  severity?: DiagnosticSeverity;
  code?: number | string;
  source?: string;
  message: string;
  relatedInformation?: DiagnosticRelatedInformation[];
}

/**
 * Call hierarchy item from LSP
 */
export interface CallHierarchyItem {
  name: string;
  kind: number;
  tags?: number[];
  detail?: string;
  uri: string;
  range: Range;
  selectionRange: Range;
  data?: any;
}

/**
 * Incoming call in call hierarchy
 */
export interface CallHierarchyIncomingCall {
  from: CallHierarchyItem;
  fromRanges: Range[];
}

/**
 * Outgoing call in call hierarchy
 */
export interface CallHierarchyOutgoingCall {
  to: CallHierarchyItem;
  fromRanges: Range[];
}

/**
 * Type hierarchy item from LSP
 */
export interface TypeHierarchyItem {
  name: string;
  kind: number;
  tags?: number[];
  detail?: string;
  uri: string;
  range: Range;
  selectionRange: Range;
  data?: any;
}

/**
 * Normalize LSP location result which can be Location | Location[] | null
 */
export function normalizeLocationResult(result: any): Location[] {
  if (!result) {
    return [];
  }

  if (Array.isArray(result)) {
    return result;
  }

  return [result];
}
