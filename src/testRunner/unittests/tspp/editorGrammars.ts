import * as Harness from "../../_namespaces/Harness.js";

interface GrammarPattern {
  readonly include?: string;
  readonly name?: string;
  readonly match?: string;
  readonly patterns?: readonly GrammarPattern[];
  readonly captures?: Readonly<Record<string, GrammarPattern>>;
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
      Object.values(pattern.captures ?? {}).forEach(visit);
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

  it("highlights every contract property supported by with clauses", () => {
    const patterns = collectPatterns(readGrammar("tspp-formal-contracts.tmLanguage.json"));
    const contractPattern = patterns.find(pattern => Object.values(pattern.captures ?? {}).some(capture => capture.name === "keyword.other.contract.tspp"));
    assert.isDefined(contractPattern, "Expected the formal contracts grammar to scope contract property names");
    assert.isDefined(contractPattern.match);
    for (const property of ["requires", "ensures", "invariant", "predicate", "numberModel", "timeout"]) {
      assert.isTrue(
        contractPattern.match.includes(property),
        `Expected the formal contracts grammar to highlight the '${property}' contract property`,
      );
    }
  });
});
