// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/**
 * Mock LSP responses for testing
 */

export const mockInitializeResult = {
  capabilities: {
    textDocumentSync: 1,
    definitionProvider: true,
    referencesProvider: true,
    hoverProvider: true,
    implementationProvider: true,
    documentSymbolProvider: true,
    workspaceSymbolProvider: true,
  },
  serverInfo: {
    name: 'clangd',
    version: '15.0.0',
  },
};

export function createMockLocation(filePath: string, line: number, column: number) {
  return {
    uri: `file://${filePath}`,
    range: {
      start: { line, character: column },
      end: { line, character: column + 10 },
    },
  };
}

export const mockDefinitionResponse = [
  createMockLocation('/path/to/file.cpp', 42, 10),
];

export const mockReferencesResponse = [
  createMockLocation('/path/to/file1.cpp', 10, 5),
  createMockLocation('/path/to/file2.cpp', 20, 15),
  createMockLocation('/path/to/file3.cpp', 30, 25),
];

export const mockHoverResponse = {
  contents: {
    kind: 'markdown',
    value: '```cpp\nint myFunction(int x)\n```\n\nDoes something useful.',
  },
  range: {
    start: { line: 10, character: 5 },
    end: { line: 10, character: 15 },
  },
};

export const mockWorkspaceSymbolsResponse = [
  {
    name: 'MyClass',
    kind: 5, // Class
    location: createMockLocation('/path/to/class.h', 10, 0),
  },
  {
    name: 'myFunction',
    kind: 12, // Function
    location: createMockLocation('/path/to/function.cpp', 50, 0),
  },
];

export const mockImplementationsResponse = [
  createMockLocation('/path/to/impl1.cpp', 100, 0),
  createMockLocation('/path/to/impl2.cpp', 200, 0),
];

export const mockDocumentSymbolsResponse = [
  {
    name: 'MyClass',
    kind: 5, // Class
    range: {
      start: { line: 10, character: 0 },
      end: { line: 50, character: 2 },
    },
    selectionRange: {
      start: { line: 10, character: 6 },
      end: { line: 10, character: 13 },
    },
    children: [
      {
        name: 'method1',
        kind: 6, // Method
        range: {
          start: { line: 20, character: 2 },
          end: { line: 25, character: 3 },
        },
        selectionRange: {
          start: { line: 20, character: 7 },
          end: { line: 20, character: 14 },
        },
      },
    ],
  },
];

export function createMockLSPError(code: number, message: string) {
  return {
    code,
    message,
    data: null,
  };
}

export const mockLSPInternalError = createMockLSPError(-32603, 'Internal error');
export const mockLSPParseError = createMockLSPError(-32700, 'Parse error');

// Diagnostics mocks
export const mockDiagnostics = [
  {
    range: {
      start: { line: 10, character: 5 },
      end: { line: 10, character: 15 }
    },
    severity: 1, // Error
    code: 'undeclared_var',
    source: 'clangd',
    message: 'Use of undeclared identifier \'foo\''
  },
  {
    range: {
      start: { line: 20, character: 0 },
      end: { line: 20, character: 10 }
    },
    severity: 2, // Warning
    code: 'unused_var',
    source: 'clangd',
    message: 'Unused variable \'bar\''
  },
  {
    range: {
      start: { line: 30, character: 2 },
      end: { line: 30, character: 12 }
    },
    severity: 3, // Information
    message: 'Consider using const here'
  }
];

export const mockDiagnosticsWithRelated = [
  {
    range: {
      start: { line: 10, character: 5 },
      end: { line: 10, character: 15 }
    },
    severity: 1, // Error
    message: 'Undefined reference to \'myFunction\'',
    relatedInformation: [
      {
        location: createMockLocation('/path/to/header.h', 5, 0),
        message: 'Function declared here'
      }
    ]
  }
];

// Call hierarchy mocks
export const mockCallHierarchyItem = {
  name: 'myFunction',
  kind: 12, // Function
  uri: 'file:///path/to/file.cpp',
  range: {
    start: { line: 10, character: 0 },
    end: { line: 20, character: 1 }
  },
  selectionRange: {
    start: { line: 10, character: 5 },
    end: { line: 10, character: 15 }
  }
};

export const mockCallHierarchyIncomingCalls = [
  {
    from: {
      name: 'caller1',
      kind: 12, // Function
      uri: 'file:///path/to/caller1.cpp',
      range: {
        start: { line: 30, character: 0 },
        end: { line: 40, character: 1 }
      },
      selectionRange: {
        start: { line: 30, character: 5 },
        end: { line: 30, character: 12 }
      }
    },
    fromRanges: [
      {
        start: { line: 35, character: 2 },
        end: { line: 35, character: 12 }
      }
    ]
  },
  {
    from: {
      name: 'caller2',
      kind: 12, // Function
      uri: 'file:///path/to/caller2.cpp',
      range: {
        start: { line: 50, character: 0 },
        end: { line: 60, character: 1 }
      },
      selectionRange: {
        start: { line: 50, character: 5 },
        end: { line: 50, character: 12 }
      }
    },
    fromRanges: [
      {
        start: { line: 55, character: 2 },
        end: { line: 55, character: 12 }
      }
    ]
  }
];

export const mockCallHierarchyOutgoingCalls = [
  {
    to: {
      name: 'callee1',
      kind: 12, // Function
      uri: 'file:///path/to/callee1.cpp',
      range: {
        start: { line: 70, character: 0 },
        end: { line: 80, character: 1 }
      },
      selectionRange: {
        start: { line: 70, character: 5 },
        end: { line: 70, character: 12 }
      }
    },
    fromRanges: [
      {
        start: { line: 15, character: 2 },
        end: { line: 15, character: 9 }
      }
    ]
  }
];

// Type hierarchy mocks
export const mockTypeHierarchyItem = {
  name: 'DerivedClass',
  kind: 5, // Class
  uri: 'file:///path/to/derived.cpp',
  range: {
    start: { line: 10, character: 0 },
    end: { line: 30, character: 1 }
  },
  selectionRange: {
    start: { line: 10, character: 6 },
    end: { line: 10, character: 18 }
  }
};

export const mockTypeHierarchySupertypes = [
  {
    name: 'BaseClass',
    kind: 5, // Class
    uri: 'file:///path/to/base.cpp',
    range: {
      start: { line: 5, character: 0 },
      end: { line: 15, character: 1 }
    },
    selectionRange: {
      start: { line: 5, character: 6 },
      end: { line: 5, character: 15 }
    }
  },
  {
    name: 'Interface',
    kind: 11, // Interface
    uri: 'file:///path/to/interface.h',
    range: {
      start: { line: 3, character: 0 },
      end: { line: 10, character: 1 }
    },
    selectionRange: {
      start: { line: 3, character: 6 },
      end: { line: 3, character: 15 }
    }
  }
];

export const mockTypeHierarchySubtypes = [
  {
    name: 'ConcreteClass',
    kind: 5, // Class
    uri: 'file:///path/to/concrete.cpp',
    range: {
      start: { line: 20, character: 0 },
      end: { line: 40, character: 1 }
    },
    selectionRange: {
      start: { line: 20, character: 6 },
      end: { line: 20, character: 19 }
    }
  }
];
