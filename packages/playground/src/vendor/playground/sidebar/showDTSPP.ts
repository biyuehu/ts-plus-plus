import { PlaygroundPlugin, PluginFactory } from ".."

// tspp fork: TS++ declarations emit as .d.tspp (the compiler never produces a .d.ts
// for .tspp sources, so the stock .D.TS tab stays empty) — this tab shows that output.
export const showDTSPPPlugin: PluginFactory = (i, utils) => {
  let codeElement: HTMLElement

  const plugin: PlaygroundPlugin = {
    id: "dtspp",
    displayName: i("play_sidebar_dtspp"),
    willMount: (_, container) => {
      const { code } = utils.createDesignSystem(container)
      codeElement = code("")
    },
    modelChanged: (sandbox, model) => {
      sandbox.getDTSPPForCode().then(dtspp => {
        if (!dtspp) {
          codeElement.textContent = i("play_sidebar_dtspp_none")
          return
        }
        sandbox.monaco.editor.colorize(dtspp, "typescript", {}).then(coloredDTSPP => {
          codeElement.innerHTML = coloredDTSPP
        })
      })
    },
  }

  return plugin
}
