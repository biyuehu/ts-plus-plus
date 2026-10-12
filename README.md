# ts-plus-plus

**English** | [简体中文](README.zh.md)

> The design proposal in [issue #1](https://github.com/biyuehu/ts-plus-plus/issues/1) is for demonstration only. It is not a plan, not a TODO, and not a commitment. Treat it as a preview of a possible direction rather than a roadmap.

ts-plus-plus is an experimental programming language inspired by TypeScript.

It aims to keep the parts of TypeScript that make typed application development approachable—familiar syntax, gradual adoption, and practical tooling—while leaving room to explore a different language design.

## Direction

ts-plus-plus is TypeScript-like, but it is not defined as a TypeScript superset. Compatibility with every TypeScript program is not a promise, and the language may deliberately choose different syntax, semantics, or type-system rules when that leads to a more coherent design.

The language also does not promise that types are always erased or that compilation is merely “remove the types and produce the same JavaScript.” Type information may participate in compilation, transformation, or runtime behavior where the language design benefits from it. The output model is an implementation choice, not the definition of the language.

## Philosophy

- Feel familiar without being constrained by compatibility.
- Treat types as a first-class part of the language design.
- Prefer clear and consistent semantics over historical behavior.
- Keep experimentation possible while the language takes shape.

The project is still at an early stage. This repository is an exploration of that direction, not a compatibility guarantee or a finalized specification.
