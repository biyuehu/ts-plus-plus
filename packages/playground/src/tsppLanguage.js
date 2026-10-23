/**
 * Monarch tokenizer for TS++ — the TypeScript grammar plus tspp keywords and constructs.
 * Based on the shape of monaco's built-in typescript language but trimmed to what a
 * playground needs: keywords, strings, comments, numbers, tspp-specific tokens.
 */
export const tsppLanguage = {
  defaultToken: "",
  tokenPostfix: ".tspp",
  keywords: [
    "abstract", "any", "as", "asserts", "assert", "assume", "bigint", "boolean", "break", "case",
    "catch", "class", "continue", "const", "constructor", "debugger", "declare", "default",
    "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "from",
    "function", "get", "if", "implements", "import", "in", "infer", "instanceof", "interface",
    "intrinsic", "is", "keyof", "let", "module", "namespace", "never", "new", "null", "number",
    "object", "package", "private", "protected", "public", "readonly", "require", "global",
    "return", "satisfies", "set", "static", "string", "super", "switch", "symbol", "this", "throw",
    "true", "try", "type", "typeof", "undefined", "unique", "unknown", "var", "void", "while",
    "with", "yield",
    // tspp keywords
    "data", "newtype", "match", "reify", "macro", "requires", "ensures", "invariant",
    "Nat", "Zero", "Succ", "Bool", "True", "False", "Sigma", "Pair", "First", "Second",
    "Eq", "Refl", "Type0", "Type1", "Type2",
  ],
  brackets: [
    { open: "{", close: "}", token: "delimiter.curly" },
    { open: "[", close: "]", token: "delimiter.square" },
    { open: "(", close: ")", token: "delimiter.parenthesis" },
  ],
  symbols: /[=><!~?:&|+\-*\/\^%]+/,
  escapes: /\\(?:[abfnrtv\\"'{}]|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
  digits: /\d+(_+\d+)*/,
  octaldigits: /[0-7]+(_+[0-7]+)*/,
  binarydigits: /[0-1]+(_+[0-1]+)*/,
  hexdigits: /[[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,

  tokenizer: {
    root: [
      // identifiers and keywords
      [
        /[a-zA-Z_$][\w$]*/,
        {
          cases: {
            "@keywords": { token: "keyword" },
            "@default": "identifier",
          },
        },
      ],
      // whitespace
      { include: "@whitespace" },
      // delimiters and operators
      [/[{}()\[\]]/, "@brackets"],
      [/@symbols/, { cases: { "@keywords": "keyword", "@default": "operator" } }],
      // numbers
      [/\d*\.\d+([eE][\-+]?\d+)?/, "number.float"],
      [/0[xX][0-9a-fA-F_]*[hH]/, "number.hex"],
      [/0[bB][0-1_]*[nN]?/, "number.binary"],
      [/0[oO][0-7_]*[nN]?/, "number.octal"],
      [/[(]\d+[nN]/, "number.bigint"],
      [/\d+[nN]?/, "number"],
      // strings
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"/, { token: "string.quote", bracket: "@open", next: "@dstring" }],
      [/'([^'\\]|\\.)*$/, "string.invalid"],
      [/'/, { token: "string.quote", bracket: "@open", next: "@sstring" }],
      [/$[`]/, { token: "string.quote", bracket: "@open", next: "@backtick" }],
      // annotations
      [/@[a-zA-Z_$][\w$]*/, "annotation"],
    ],
    whitespace: [
      [/[ \t\r\n]+/, ""],
      [/\/\*\*(?!\/)/, "comment.doc", "@jsdoc"],
      [/\/\*/, "comment", "@comment"],
      [/\/\/.*$/, "comment"],
    ],
    comment: [
      [/[^/*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[/*]/, "comment"],
    ],
    jsdoc: [
      [/[^/*]+/, "comment.doc"],
      [/\*\//, "comment.doc", "@pop"],
      [/[/*]/, "comment.doc"],
    ],
    dstring: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
    ],
    sstring: [
      [/[^\\']+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/'/, { token: "string.quote", bracket: "@close", next: "@pop" }],
    ],
    backtick: [
      [/\$\{/, { token: "delimiter.bracket", next: "@interpolation" }],
      [/[^\\`$]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/`/, { token: "string.quote", bracket: "@close", next: "@pop" }],
    ],
    interpolation: [
      [/\}/, { token: "delimiter.bracket", next: "@backtick" }],
      { include: "root" },
    ],
  },
};
