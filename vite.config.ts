/// <reference types="vitest/config" />
import { defineConfig, type Alias } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import process from "node:process";

/** Resolve a project-relative path to an absolute file URL. */
const resolve = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/** Build the resolve-alias array, adding browser-mode shims when needed. */
function buildAliases(isBrowser: boolean): Alias[] {
  const aliases: Alias[] = [
    { find: "@", replacement: resolve("./src") },
    // `invoke` with remote-development routing (src/platform/tauriCore.ts).
    {
      find: /^@tauri-apps\/api\/core$/,
      replacement: resolve("./src/platform/tauriCore.ts"),
    },
  ];

  if (isBrowser) {
    aliases.push(
      { find: /^@tauri-apps\/api\/event$/, replacement: resolve("./src/platform/shims/tauriEvent.ts") },
      { find: /^@tauri-apps\/api\/window$/, replacement: resolve("./src/platform/shims/tauriWindow.ts") },
      { find: /^@tauri-apps\/api\/webview$/, replacement: resolve("./src/platform/shims/tauriWebview.ts") },
      { find: /^@tauri-apps\/api\/webviewWindow$/, replacement: resolve("./src/platform/shims/tauriWebviewWindow.ts") },
      { find: /^@tauri-apps\/api\/path$/, replacement: resolve("./src/platform/shims/tauriPath.ts") },
      { find: /^@tauri-apps\/plugin-dialog$/, replacement: resolve("./src/platform/shims/tauriDialog.ts") },
      { find: /^@tauri-apps\/plugin-opener$/, replacement: resolve("./src/platform/shims/tauriOpener.ts") },
    );
  }

  return aliases;
}

export default defineConfig(({ mode }) => {
  const isBrowserBuild = mode === "browser";
  const host = isBrowserBuild ? undefined : process.env.TAURI_DEV_HOST;

  return {
    plugins: [react()],
    resolve: {
      alias: buildAliases(isBrowserBuild),
    },
    // Tauri: keep Rust errors visible, fixed port, don't watch the backend.
    clearScreen: false,
    server: {
      port: isBrowserBuild ? 5173 : 1420,
      strictPort: !isBrowserBuild,
      host: host || false,
      hmr: host ? { protocol: "ws", host } : undefined,
      watch: { ignored: ["**/src-tauri/**", "**/crates/**", "**/target/**"] },
    },
    build: {
      target: "safari16",
      sourcemap: true,
    },
    test: {
      environment: "jsdom",
      globals: false,
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}", "perf/**/*.test.ts", "scripts/**/*.test.ts"],
    },
  };
});
