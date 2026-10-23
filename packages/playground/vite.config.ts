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
  worker: {
    // the tspp worker imports monaco's ESM modules, so it must stay an ES module worker
    format: "es",
  },
  build: {
    // monaco + the compiler bundle are large; silence the default warning
    chunkSizeWarningLimit: 6000,
  },
});
