// First-party monaco EDITOR worker (label "editorWorkerService": link detection,
// diff computation, unicode suggestions, ...). Monaco's own npm-internal worker
// entry is not bundled cleanly by vite in 0.57 (relative imports survive into the
// emitted chunk, which then fails to load from a blob URL), so the boot wires
// MonacoEnvironment.getWorker here for every non-TS label.
import * as editorWorker from "monaco-editor/editor/editor.worker.js";

self.onmessage = () => {
  editorWorker.initialize(() => ({}));
};
