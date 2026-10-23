/**
 * Worker entry that replaces monaco's stock TypeScript worker (this file is copied
 * over node_modules/monaco-editor/.../ts.worker.js by scripts/patch-monaco-worker.mjs
 * — see that file for why). The TsppWorker import uses a vite root-absolute path so
 * it resolves no matter where this entry file physically lives.
 *
 * The compiler module is NOT bundled into this worker: it is fetched from the URL the
 * main thread hands over as this worker's FIRST message ({tsppCompilerUrl}), then
 * imported through an object URL, so main thread and worker share one compiler
 * instance and `?ts=dev` swaps the compiler without rebuilding the worker. (Worker
 * globals are separate from the main thread's — a globalThis set in boot.ts is
 * invisible here — hence the message channel; globalThis.TSPP_COMPILER_URL remains a
 * secondary fallback for main-thread contexts.) The bundle is self-contained (no
 * relative imports), enforced by scripts/build-bundle.mjs externals.
 *
 * Ordering matters, twice. Worker messages are NEVER dispatched during the initial
 * script evaluation — they queue until the script yields — so the compiler URL
 * cannot be read synchronously; it is delivered by the buffered message channel
 * below (a promise resolved from onmessage). And in monaco 0.57 the main thread
 * posts "ignore" (the initialization trigger, swallowed), then createData; the
 * stock editor.worker pipeline turns the first post-initialize message into
 * createData. The TsppWorker constructor needs the compiler synchronously, so
 * every message is buffered, the compiler is awaited, then the stock pipeline is
 * installed and the buffer is replayed (skipping "ignore").
 */
import * as editorWorker from "monaco-editor/editor/editor.worker.js";
import { TsppWorker } from "/src/worker/tsppWorkerClass.js";

const earlyMessages = [];
let resolveCompilerUrl;
/** Resolves with the {tsppCompilerUrl} message the main thread posts right after
 *  constructing this worker (see MonacoEnvironment.getWorker in boot.ts). */
const compilerUrlMessage = new Promise(resolve => {
  resolveCompilerUrl = resolve;
});
self.onmessage = e => {
  const d = e?.data;
  if (d && typeof d === "object" && typeof d.tsppCompilerUrl === "string") {
    resolveCompilerUrl(d.tsppCompilerUrl);
    return;
  }
  earlyMessages.push(e);
};

/** @type {Promise<*>} */
const compilerReady = (async () => {
  // The URL message can only arrive after this script yielded, hence the await.
  // The timeout falls back to the main-thread-style global for exotic spawners.
  const fromMessage = await Promise.race([
    compilerUrlMessage,
    new Promise(resolve => setTimeout(() => resolve(undefined), 5000)),
  ]);
  const url = fromMessage ?? self.TSPP_COMPILER_URL;
  if (!url) {
    throw new Error(
      "No compiler URL: boot.ts must post {tsppCompilerUrl} as this worker's first message",
    );
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  return import(
    /* @vite-ignore */ URL.createObjectURL(new Blob([await res.text()], { type: "text/javascript" })),
  );
})();

compilerReady.then(tspp => {
  // Install the stock pipeline behind a guard wrapper: the wrapper swallows any
  // "ignore" handshake (in the stock entry it only triggers initialization and is
  // never createData), forwards the first real message (createData) to the stock
  // handler, and then hands control back — the stock pipeline replaces onmessage
  // itself during start(), so later messages must reach it unfiltered.
  editorWorker.initialize((ctx, createData) => new TsppWorker(ctx, createData, tspp));
  const stockOnMessage = self.onmessage;
  self.onmessage = e => {
    if (e?.data === "ignore") return;
    self.onmessage = stockOnMessage;
    stockOnMessage(e);
  };
  for (const e of earlyMessages) self.onmessage(e);
  earlyMessages.length = 0;
}, err => {
  console.error("[tspp worker] failed to load the compiler module", err);
  // Surface the failure to the main thread's first RPC instead of hanging silently;
  // later messages are only logged so the console does not fill with repeats.
  let first = true;
  self.onmessage = () => {
    if (first) {
      first = false;
      throw err;
    }
    console.error("[tspp worker] compiler module unavailable", err);
  };
});
