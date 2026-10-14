import * as Harness from "../../_namespaces/Harness.js";

interface GrammarPattern {
  readonly include?: string;
  readonly name?: string;
  readonly patterns?: readonly GrammarPattern[];
}

interface Grammar {
  readonly patterns: readonly GrammarPattern[];
  readonly repository?: Readonly<Record<string, GrammarPattern>>;
}

describe("unittests:: tspp:: editor grammars", () => {
  const grammarFileNames = [
    "tspp-formal-contracts.tmLanguage.json",
    "tspp-kind-operators.tmLanguage.json",
    "tspp-macros.tmLanguage.json",
    "tspp-nominal-declarations.tmLanguage.json",
  ];

  function readGrammar(fileName: string): Grammar {
    const path = `vscode-extension/syntaxes/${fileName}`;
    const text = Harness.IO.readFile(path);
    assert.isDefined(text, `Expected to find ${path}`);
    return JSON.parse(text) as Grammar;
  }

  function collectPatterns(grammar: Grammar): readonly GrammarPattern[] {
    const result: GrammarPattern[] = [];
    const visit = (pattern: GrammarPattern) => {
      result.push(pattern);
      pattern.patterns?.forEach(visit);
    };
    grammar.patterns.forEach(visit);
    Object.values(grammar.repository ?? {}).forEach(visit);
    return result;
  }

  it("leaves angle-bracket classification to TypeScript's contextual grammars", () => {
    for (const fileName of grammarFileNames) {
      const patterns = collectPatterns(readGrammar(fileName));
      assert.isFalse(
        patterns.some(pattern => pattern.name === "keyword.operator.relational.ts"),
        `${fileName} must not override contextual angle-bracket classification`,
      );
    }

    const macros = collectPatterns(readGrammar("tspp-macros.tmLanguage.json"));
    assert.isTrue(
      macros.some(pattern => pattern.include === "source.ts#type-annotation"),
      "TS++ declarations should reuse TypeScript's shared type-context grammar",
    );
  });
});
