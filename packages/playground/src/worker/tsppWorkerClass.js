/**
 * The tspp TypeScriptWorker class, factored out of the worker entry so it can be exercised
 * directly (see scripts/worker-spike.mjs) with a mock of monaco's mirror-model context.
 *
 * The class extends the TypeScriptWorker vendored inside monaco-editor, so the worker
 * protocol always matches the monaco version the client uses.
 */
// NOTE: imported by disk-relative path, not by the "monaco-editor/esm/vs/..." package
// specifier: monaco 0.57's exports map ("./esm/vs/*.js") double-prefixes such deep
// imports both in Node and (without the vite alias) at build time.
import { TypeScriptWorker } from "../../node_modules/monaco-editor/esm/vs/languages/features/typescript/tsWorker.js";
import { solveBatch as solveZ3Batch } from "./z3Bridge.js";

export class TsppWorker extends TypeScriptWorker {
  /**
   * @param {*} ctx monaco's IWorkerContext (mirror-models host)
   * @param {*} createData
   * @param {*} tspp the loaded compiler bundle module (the worker entry only constructs
   *   this class after the runtime-fetched compiler module has finished loading, so it
   *   arrives synchronously — no construction-time race with incoming RPC requests)
   */
  constructor(ctx, createData, tspp) {
    super(ctx, createData);
    this._tspp = tspp;
    // Replace the stock language service (created in the base constructor with
    // monaco's bundled TypeScript) with one from the tspp compiler bundle.
    this._languageService = tspp.createLanguageService(this);
  }

  get tspp() {
    return this._tspp;
  }

  getScriptKind(fileName) {
    if (fileName.endsWith(".tspp") || fileName.endsWith(".d.tspp")) {
      return this.tspp.ScriptKind.TS;
    }
    return super.getScriptKind(fileName);
  }

  /**
   * Formal-verification obligations for the Verify sidebar tab: a plain passthrough
   * to the compiler's program API. With the host solver seam wired (see
   * setCompilerHost), the artifacts the program carries are already final — proved,
   * failed with a counterexample, or unknown with a reason — because the compiler
   * produced them after its own async solve through this host.
   *
   * @returns {Promise<object[]>}
   */
  async getVerificationArtifacts() {
    const program = this._languageService.getProgram();
    return program?.getVerificationArtifacts?.() ?? [];
  }

  /**
   * The compiler's verification seam (CompilerHost.solveVerificationQueries,
   * @internal): the services layer calls languageServiceHost.setCompilerHost
   * with its constructed CompilerHost, and the compiler's
   * runVerificationQueries prefers that hook over its node:worker_threads Z3
   * worker when present. This is the whole browser Z3 integration — the
   * compiler then drives artifacts, the 18090 diagnostics, and its own
   * placeholder→resolved program sync end to end.
   *
   * @param {*} compilerHost the compiler's CompilerHost for this language service
   */
  setCompilerHost(compilerHost) {
    compilerHost.solveVerificationQueries = (inputs, cancellationToken) => solveZ3Batch(inputs, cancellationToken);
    compilerHost.resolveMacroModule = specifier => specifier === "ts-plus-plus" ? this.tspp : undefined;
  }
}
