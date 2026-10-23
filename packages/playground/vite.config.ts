import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  // relative base so the site works from a GitHub Pages project subpath
  base: "./",
  server: {
    // launch.json opens this exact URL; fail clearly instead of moving to a
    // different port while the debugger opens an unrelated or stale server.
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: [
      // monaco 0.57's exports map ("./esm/vs/*.js") double-prefixes deep "esm/vs/..."
      // imports, so resolve them directly on disk
      {
        find: /^monaco-editor\/esm\/vs\//,
        replacement: fileURLToPath(new URL("./node_modules/monaco-editor/esm/vs/", import.meta.url)),
      },
    ],
  },
  worker: {
    // the tspp worker imports monaco's ESM modules, so it must stay an ES module worker
    format: "es",
  },
  build: {
    // monaco + the compiler bundle are large; silence the default warning
    chunkSizeWarningLimit: 6000,
  },
});
