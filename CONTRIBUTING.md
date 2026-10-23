# Contributing to TS++

Thank you for your interest in contributing to TS++ (ts-plus-plus)!

TS++ is an experimental TypeScript-derived language focused on advanced type systems, Martin-Löf Type Theory (MLTT), and Z3-backed formal contract verification.

## Getting Started

### Prerequisites

- **Node.js**: v22 or later
- **npm**: v8 or later
- **Git**

### Installation

Clone the repository and install dependencies:

```sh
git clone https://github.com/tspp-lang/tspp.git
cd ts-plus-plus
npm ci
```

Git hooks will be automatically configured via `lefthook` during `prepare`. **And you need setup scripts**:

```sh
npm run setup-hooks
```

## Development Workflow

### Building the Compiler

Build the local compiler:

```sh
npx hereby local
```

Build the entire compiler and test suites:

```sh
npm run build
```

### Running Tests

Run the targeted TS++ test suites:

```sh
npx hereby runtests --tests="tspp"
```

To run a specific test suite:

```sh
npx hereby runtests --tests="tspp:: type computation"
```

### Formatting & Linting

We use [dprint](https://dprint.dev/) for code formatting and ESLint for static analysis:

```sh
# Format all code
npx dprint fmt

# Run ESLint
npm run lint

# Check for unused exports and dependencies
npm run knip
```

The pre-commit hook (powered by `lefthook`) automatically formats staged files with `dprint`, runs ESLint with caching on changed files, and validates exports using `knip`.

## Pull Request Guidelines

1. **Focused Changes**: Keep pull requests focused on a single feature, bug fix, or documentation improvement.
2. **Commit Messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/) format (e.g., `feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`).
3. **Tests**: Add unit tests for any new language features, checker rules, or syntax transformations under `packages/compiler/src/testRunner/unittests/tspp/`.
4. **Clean Diffs**: Always ensure files are formatted via `npx dprint fmt` and avoid accidental line ending conversions.

## Contributor Wall

Once your pull request is merged into the `main` branch, you will automatically be included in the Contributor Wall on the README!

You can also preview or regenerate the contributor wall locally:

```sh
npm run contributors
```
