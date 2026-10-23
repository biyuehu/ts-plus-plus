# tspp-playground

Online playground for [tspp-lang/tspp](https://github.com/tspp-lang/tspp) (TS++), built on the
official [TypeScript Playground](https://github.com/microsoft/TypeScript-Website) UI (vendored,
MIT) so the editor experience matches what TypeScript developers already know.

Live at <https://tspp-lang.github.io/playground/>.

## Architecture

```
index.html + src/boot.ts                 boot: monaco, compiler fetch, sandbox + UI wiring
  ├── src/vendor/                        official playground + sandbox, forked (see below)
  │     ├── sandbox/                     @typescript/sandbox — monaco editor + language service glue
  │     └── playground/                  @typescript/playground — navbar, sidebar plugins, options UI
  ├── src/worker/tspp.worker.js          worker entry (replaces monaco's stock ts.worker — see patch)
  │     └── tsppWorkerClass.js           TsppWorker extends monaco's TypeScriptWorker; swaps in the
  │                                      tspp createLanguageService and .tspp script kinds
  ├── public/vendor/typescript.js        THE COMPILER: browser ESM bundle of tspp-lang/tspp,
  │                                      fetched at runtime by both the main thread and the worker
  ├── examples/                          example seeds (generated: scripts/generate-examples.mjs)
  └── dist/                              production build (vite, deployed to GitHub Pages)
```

Key facts that are easy to get wrong again:

- **The compiler bundle is not part of the app bundle.** `public/vendor/typescript.js` is
  committed and served as-is; `src/boot.ts` fetches it, imports it via an object URL, and
  hands the URL to workers as their **first message** (`{tsppCompilerUrl}` from
  `MonacoEnvironment.getWorker`). Worker globals are separate from the main thread's (a
  `globalThis` set in boot is invisible there), and worker messages are not dispatched until
  the worker's initial script finishes evaluating — so the entry awaits the URL through a
  promise resolved from `onmessage` (5s timeout as a safety net). Each context fetches the
  compiler from the same URL, sharing the HTTP cache. This keeps the app chunks small, makes
  `?ts=dev` possible, and is the same seam a future z3-solver WASM module will use.
- **Object URLs, not direct dynamic imports.** Vite's `__vitePreload` re-bases relative
  dynamic-import specifiers against the importing chunk's directory (`assets/`), which 404s.
  Never `import(compilerUrl)` directly — go through `fetch` + `URL.createObjectURL`. Also
  never put an `await` inside the dynamic import's argument expression; the `__vitePreload`
  transform cannot hoist it and the build fails with a bogus "await is only allowed within
  async functions" PARSE_ERROR.
- **monaco 0.57 ESM gotchas** (all hard-won, all still true):
  - import `monaco-editor/esm/vs/editor/editor.main.js` — plain `editor.api.js` has no
    contributions (no hover/suggest/find/goto-definition).
  - the TS language-mode namespace must be attached manually:
    `monaco.languages.typescript = import("monaco-editor/esm/vs/language/typescript/monaco.contribution.js")`.
  - language ids come from `esm/vs/languages/definitions/<lang>/register.js`.
  - monaco's exports map double-prefixes deep `esm/vs/...` specifiers; `vite.config.ts`
    aliases them onto disk paths, and Node code (spikes) imports the files by disk path.
  - the TypeScript mode's `workerManager.js` spawns its worker with a literal
    `new Worker(new URL("ts.worker.js", import.meta.url))` — it consults neither
    `MonacoEnvironment.getWorker` nor build-time aliases. Hence the patch below.
- **Worker spawn routing.** `MonacoEnvironment.getWorker` in `boot.ts` takes over all spawns
  and routes them to two first-party, fully-bundled entries: TS labels →
  `src/worker/tspp.worker.js`, everything else → `src/editorWebWorker.js`. The npm-internal
  worker entries vite 0.57 emits still leak relative imports and fail blob-URL loading.
- **Ordering inside the tspp worker.** The main thread posts `{tsppCompilerUrl}`, then
  `"ignore"`, then `createData`; monaco's editor.worker pipeline constructs the request
  handler from the first message, but `TsppWorker`'s constructor needs the compiler module
  synchronously. The entry therefore awaits the compiler URL via a promise resolved from
  `onmessage` (messages never dispatch during initial script evaluation), buffers every
  other early message, awaits the compiler fetch, installs the real pipeline behind a guard
  that swallows the `"ignore"` handshake, and replays the buffer. Do not replace this with a
  lazily-`await`ed compiler inside methods — the base class constructs its stock language
  service in its constructor, and an RPC that lands before the swap silently answers with
  the wrong compiler.
- **Run + `module: commonjs`.** Upstream's site compiles the playground to AMD, where the
  eval running user code sits inside `define(["require","exports",...], function (require,
  exports, ...))` — CommonJS output resolves `exports`/`require` to those factory params and
  "just works". This fork is a vite ESM bundle whose scope has neither binding, so
  `runWithCustomLogs` wraps the eval'd code in an IIFE providing `exports`, `module` (with
  the `module.exports === exports` invariant), and a `require` that throws a clear error.
  The eval must stay a *direct* eval so user code sees the shadowed console.

## Vendor conventions (`src/vendor/`)

The official `@typescript/sandbox` + `@typescript/playground` sources are vendored verbatim
(they are not published as tree-shakeable ESM packages). Every deviation from upstream is
tagged with a `// tspp fork:` comment on its own line, so future upstream syncs are a diff
against those markers. When upgrading the official playground:

1. re-apply each `// tspp fork:` change to the new sources,
2. re-check the `main>nav`-keyed CSS assumptions (see below),
3. re-run the build and click through: dropdowns, examples, feature panel, run button.

Compiled site CSS (`src/vendor/site.css`) comes from the official site's `main.scss` — the
playground's own stylesheet keys off `main > nav` selectors and CSS variables
(`--playground-dropdown-bg` etc.) that the standalone site normally provides. `index.html`
wraps the playground DOM in `<main role="main">` for the same reason, and `src/style.css`
supplies the bootstrap-reboot `box-sizing: border-box` the official styles assume.

## The monaco worker patch (`scripts/patch-monaco-worker.mjs`)

Copies `src/worker/tspp.worker.js` over
`node_modules/monaco-editor/esm/vs/languages/features/typescript/ts.worker.js`, because that
literal file is what `workerManager.js` spawns. It compares full content (not a keyword) so
it re-copies whenever the entry changes, and it runs automatically before `npm run dev` /
`npm run build` and on every `npm install` (postinstall). If you upgrade monaco and the
worker starts answering with stock-TS diagnostics, this patch is the first suspect.

## Development

```pwsh
npm run spike        # phase 0 feasibility spike (loads the ts-plus-plus package)
npm run worker-spike # drives TsppWorker with a mock worker context, no browser (expects public/vendor/typescript.js)
npm run bundle       # build the browser ESM compiler bundle from the main repo sources -> public/vendor/typescript.js
npm run bundle:dev   # same, but -> public/typescript.dev.js (git-ignored) for ?ts=dev
npm run dev          # vite dev server (auto-repairs the monaco worker patch first)
npm run build        # production build into dist/ (auto-repairs the patch first)
```

The bundle steps resolve compiler sources through the `ts-plus-plus` dependency. The load spike's
bundle can be overridden with `TSPP_BUNDLE=<path to typescript.js>`.

### Editing the compiler without a site deploy (`?ts=dev`)

The deployed site always runs the committed `public/vendor/typescript.js`, which CI rebuilds
from `tspp-lang/tspp` main on every push. To test a local compiler change in the playground:

```pwsh
# in packages/playground
npm run bundle:dev   # ~30s: esbuild straight from the main repo's TypeScript sources
npm run dev          # then open http://localhost:5173/?ts=dev
```

`?ts=dev` switches both the main thread and the worker to `public/typescript.dev.js`.
Re-run `bundle:dev` after each compiler edit and reload. Forgetting the build shows an
explicit "Run `npm run bundle:dev` …" message in the loader area instead of a hang.
Production builds ignore the query param; the committed bundle always ships.

## Deployment

Push to `main` or `master` runs the root
`.github/workflows/playground.yml`: install the compiler and playground dependencies,
build the compiler package, regenerate the compiler bundle and examples from this checkout,
build the Vite app, and publish `packages/playground/dist` to Pages. Pages CDN propagation
can lag a few minutes after a green run—a 404 on a freshly renamed chunk is propagation,
not breakage; retry with a cache-bust query and verify new behavior by marker strings
inside the minified chunks.

## Roadmap

- [x] **Phase 0 — packaging spike**: load the forked `typescript.js` lib bundle outside the build tree, run the
      language service on an in-memory `.tspp` project with `tsppFeatures` compiler options, verify diagnostics and
      emit (this is the load-bearing feasibility check; see `spike/load-spike.mjs`).
- [x] **Phase 1 — MVP**: forked tsWorker bundle, custom `.tspp` syntax highlighting, feature-toggle panel,
      sidebar (JS output / declarations / diagnostics), example seeds, share links, GitHub Pages deploy.
- [x] **Phase 2 — UX**: official playground UI vendored and fully wired, runnable JS output panel,
      effective-feature checkbox states, local `ts=dev` build integration.
- [ ] **Phase 3 — verification sidebar**: formal-contract obligations display; browser Z3 (z3-solver WASM) backend.
- [ ] **Phase 4 — multi-version**: versioned CDN bundles + release index.
