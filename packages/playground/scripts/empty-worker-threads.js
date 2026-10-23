// Stub for esbuild aliasing "worker_threads" in the z3 worker bundle: the
// require site is guarded by `if (isNode)` which is dead in a web worker.
export const workerData = undefined;
export const parentPort = undefined;
