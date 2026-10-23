import type { Sandbox } from "@typescript/sandbox"
import { PlaygroundPlugin, PluginFactory } from ".."

// tspp fork: the formal-verification panel. The compiler attaches proof obligations
// (function contracts, loop invariants, call-site preconditions) as
// VerificationArtifacts on the program when the formalContracts feature is enabled;
// each carries its position, status, and a replayableSmtLib script. Solving runs
// through the language service's async seam: the first request attaches placeholder
// artifacts ("Formal verification is running asynchronously.") and the resolved
// program syncs on the next language-service request, so this tab polls a few times.
// Without a Z3 backend in the browser, statuses settle at "unknown" with the full
// SMT-LIB text still available for replay elsewhere.
type VerificationArtifact = {
  taskId: string
  kind: string
  obligation: string
  name: string
  status: "proved" | "failed" | "unknown" | "error"
  message: string
  start: number
  length: number
  counterexample?: string
  replayableSmtLib: string
}

const PLACEHOLDER_MESSAGE = "Formal verification is running asynchronously."

const statusBadge = (status: VerificationArtifact["status"]) => {
  const map = {
    proved: { label: "proved ✓", color: "#3fb950" },
    failed: { label: "failed ✗", color: "#e5534b" },
    unknown: { label: "unknown ?", color: "#9e9e9e" },
    error: { label: "error ✗", color: "#e5534b" },
  } as const
  const { label, color } = map[status]
  const span = document.createElement("span")
  span.textContent = label
  span.style.cssText = `color:${color};font-weight:700;`
  return span
}

export const showVerificationPlugin: PluginFactory = (i, utils) => {
  let container: HTMLElement
  let sandbox: Sandbox
  let ds: ReturnType<typeof utils.createDesignSystem>
  let poll: ReturnType<typeof setTimeout> | undefined
  let fetchGeneration = 0
  let lastRendered = ""

  const jumpTo = (artifact: VerificationArtifact) => {
    const model = sandbox.getModel()
    const start = model.getPositionAt(artifact.start)
    const end = model.getPositionAt(artifact.start + Math.max(artifact.length, 1))
    sandbox.editor.setSelection({
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    })
    sandbox.editor.revealPositionInCenter(start)
    sandbox.editor.focus()
  }

  const render = (artifacts: readonly VerificationArtifact[]) => {
    ds.clear()
    if (!artifacts.length) {
      ds.showEmptyScreen(i("play_sidebar_verify_none"))
      return
    }
    ds.subtitle(`${artifacts.length} ${i("play_sidebar_verify_count")}`)
    for (const artifact of artifacts) {
      const item = document.createElement("div")
      item.style.cssText = "margin:10px 0;padding:6px 8px;border:1px solid var(--secondary-button-background,#444);border-radius:6px;cursor:pointer;"
      item.onclick = () => jumpTo(artifact)

      const head = document.createElement("div")
      head.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;"
      head.appendChild(statusBadge(artifact.status))
      const kind = document.createElement("span")
      kind.textContent = `${artifact.kind} · ${artifact.obligation}`
      kind.style.cssText = "opacity:0.8;"
      head.appendChild(kind)
      const name = document.createElement("strong")
      name.textContent = artifact.name
      head.appendChild(name)
      item.appendChild(head)

      const message = document.createElement("div")
      message.textContent = artifact.message
      message.style.cssText = "margin-top:4px;font-size:0.9em;opacity:0.85;"
      item.appendChild(message)

      if (artifact.counterexample) {
        const counterexample = document.createElement("pre")
        counterexample.textContent = artifact.counterexample
        counterexample.style.cssText = "margin:6px 0 0;padding:6px;background:var(--child-background-equivalent,#222);border-radius:4px;overflow-x:auto;font-size:0.85em;"
        item.appendChild(counterexample)
      }

      if (artifact.replayableSmtLib) {
        const tools = document.createElement("div")
        tools.style.cssText = "margin-top:6px;display:flex;gap:6px;align-items:center;"
        const toggle = document.createElement("button")
        toggle.type = "button"
        toggle.textContent = i("play_sidebar_verify_show_smt")
        const copy = document.createElement("button")
        copy.type = "button"
        copy.textContent = i("play_sidebar_verify_copy")
        for (const button of [toggle, copy]) {
          button.style.cssText = "background:none;color:var(--link-color,#4bb3b3);border:1px solid var(--secondary-button-background,#444);border-radius:4px;padding:1px 6px;font-size:0.8em;cursor:pointer;"
        }
        copy.onclick = async event => {
          event.stopPropagation()
          try {
            await navigator.clipboard.writeText(artifact.replayableSmtLib)
            copy.textContent = i("play_sidebar_verify_copied")
          } catch {
            copy.textContent = i("play_sidebar_verify_copy_fail")
          }
          setTimeout(() => (copy.textContent = i("play_sidebar_verify_copy")), 1500)
        }
        const smt = document.createElement("pre")
        smt.textContent = artifact.replayableSmtLib
        smt.style.cssText = "display:none;margin:6px 0 0;padding:6px;background:var(--child-background-equivalent,#222);border-radius:4px;overflow-x:auto;font-size:0.8em;white-space:pre;"
        toggle.onclick = event => {
          event.stopPropagation()
          const showing = smt.style.display !== "none"
          smt.style.display = showing ? "none" : "block"
          toggle.textContent = showing ? i("play_sidebar_verify_show_smt") : i("play_sidebar_verify_hide_smt")
        }
        tools.appendChild(toggle)
        tools.appendChild(copy)
        item.appendChild(tools)
        item.appendChild(smt)
      }

      container.appendChild(item)
    }
  }

  // First request returns placeholders while the async solve is in flight; poll
  // (bounded) until they resolve. The solved program syncs on the next
  // language-service request, so a fresh RPC returns the real result.
  const refreshEditorDiagnostics = () => {
    // The browser Z3 backend settles obligations asynchronously from monaco's
    // point of view: the compiler rotates to a solved program and the Verify tab
    // sees it, but monaco's TS DiagnosticsAdapter only revalidates on model
    // changes. Poking setDiagnosticsOptions (same options back) fires the
    // defaults' onDidChange, which revalidates every model — pulling the
    // compiler's now-final verification diagnostics. Called on every settle:
    // revalidation is triggered only when the artifact set changes, and the
    // options never change here, so no dedup — a deduped poke silently drops
    // the refresh for every solve after the first.
    // (monaco lives on the sandbox, not on window: boot.ts imports it as ESM.)
    const monaco = (sandbox as any).monaco ?? (window as any).monaco
    const defaults = monaco?.languages?.typescript?.typescriptDefaults
    if (defaults?.setDiagnosticsOptions) defaults.setDiagnosticsOptions(defaults.getDiagnosticsOptions())
  }
  const fetchArtifacts = async (attempt: number, generation: number) => {
    if (generation !== fetchGeneration) return
    let artifacts: VerificationArtifact[] = []
    try {
      const worker = await sandbox.getWorkerProcess()
      artifacts = (await worker.getVerificationArtifacts()) ?? []
    } catch {
      return // worker still booting; the next model change retries
    }
    if (generation !== fetchGeneration) return
    const serialized = JSON.stringify(artifacts)
    const pending = artifacts.some(a => a.message === PLACEHOLDER_MESSAGE)
    if (serialized !== lastRendered) {
      lastRendered = serialized
      render(artifacts)
    }
    if (!pending) refreshEditorDiagnostics()
    if (pending) {
      // The first browser solve fetches a 35 MB wasm, so poll fast at first and
      // fall back to a slow indefinite tail (bounded by the tab's lifetime —
      // didUnmount clears the timer) until the solve lands.
      clearTimeout(poll)
      poll = setTimeout(() => void fetchArtifacts(attempt + 1, generation), attempt < 40 ? 400 : 2000)
    }
  }

  const scheduleFetch = () => {
    const generation = ++fetchGeneration
    void fetchArtifacts(0, generation)
  }

  const plugin: PlaygroundPlugin = {
    id: "verification",
    displayName: i("play_sidebar_verify"),
    willMount: (_sandbox, _container) => {
      sandbox = _sandbox
      container = _container
      ds = utils.createDesignSystem(container)
      ds.showEmptyScreen(i("play_sidebar_verify_loading"))
      scheduleFetch()
    },
    // Playground-provided debounce: fires after edits settle while this tab is active.
    modelChangedDebounce: () => {
      lastRendered = "" // force a re-render even if the JSON string is unchanged
      scheduleFetch()
    },
    didUnmount: () => {
      clearTimeout(poll)
      fetchGeneration++
    },
  }

  return plugin
}
