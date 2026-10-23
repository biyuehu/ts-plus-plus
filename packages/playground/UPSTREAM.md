# Upstream

The playground UI and sandbox sources in `src/vendor` are derived from
[`microsoft/TypeScript-Website`](https://github.com/microsoft/TypeScript-Website).

- Upstream branch: `v2`
- Upstream commit: `04569788cf46f97e2f16356639bc9635c88c0a61`
- Upstream commit date: 2026-10-15
- Imported source directories:
  - `packages/playground/src` → `src/vendor/playground`
  - `packages/sandbox/src` → `src/vendor/sandbox`
- License: MIT; see [`LICENSE`](./LICENSE)

This commit intentionally contains the unmodified upstream source snapshot. TS++ adaptations
are applied in its child commit so future updates can distinguish the baseline from the fork.
