/// <reference path="fourslash.ts"/>

// @tsppFeatures: higherKindedTypes,typeUniverses

// @Filename: test.tspp
////type UniverseZero: Type1 = Type0;
////type Arrays: UniverseZero => UniverseZero = Array;

const c = classification("2020");
verify.semanticClassificationsAre("2020",
    c.semanticToken("type.declaration", "UniverseZero"),
    c.semanticToken("type", "Type1"),
    c.semanticToken("type", "Type0"),
    c.semanticToken("type.declaration", "Arrays"),
    c.semanticToken("type", "UniverseZero"),
    c.semanticToken("type", "UniverseZero"),
    c.semanticToken("interface.defaultLibrary", "Array"),
);
