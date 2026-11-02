/**
 * `@tauri-apps/api/core` as the app imports it (a Vite alias points here):
 * the package itself, except that `invoke` asks the installed route first, so
 * a remote-development window can send commands to its server
 * (platform/remote.ts). `window.__TAURI_INTERNALS__.invoke` is read-only, so
 * this is the one place to hook.
 *
 * In browser mode (no `__TAURI_INTERNALS__`), this module provides safe shims
 * so features can load without crashing. Commands reject with an error that
 * clearly identifies the missing backend.
 */

// Re-export types — these are always safe (erased at runtime).
import type { InvokeArgs, InvokeOptions } from "../../node_modules/@tauri-apps/api/core.js";
export type { InvokeArgs, InvokeOptions };

const _isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ---------- Browser-mode shims ----------

class BrowserChannel<T> {
  /** Registered callback, called when the backend sends a stream message. */
  onmessage: (response: T) => void = () => {};
  /** The "callback id" — meaningless in the browser, but present for type compat. */
  readonly id = 0;
  /** @internal — Tauri's `Channel` stores a `__TAURI_CHANNEL_MARKER__`. */
  readonly __TAURI_CHANNEL_MARKER__ = true as const;
  toJSON() {
    return `__CHANNEL__:${this.id}`;
  }
}

function browserInvoke(): Promise<never> {
  return Promise.reject(
    new Error("invoke() is not available in the browser. This command requires the Tauri desktop backend."),
  );
}

function browserTransformCallback(_callback: (...args: unknown[]) => unknown, _once?: boolean): number {
  return 0;
}

// ---------- Tauri-mode: real imports ----------

// Conditional dynamic re-exports. The static `import` of the real module is
// only executed when Tauri is present, so it cannot crash a browser page.
// (The module is still in the bundle when using `pnpm dev` — that's fine,
// `@tauri-apps/api/core` itself guards on `__TAURI_INTERNALS__` at call time.)

type InvokeLocal = <T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions) => Promise<T>;

let _invokeLocal: InvokeLocal;
let _Channel: { new <T>(): { onmessage: (response: T) => void; readonly id: number } };
let _transformCallback: (callback: (...args: unknown[]) => unknown, once?: boolean) => number;

if (_isTauri) {
  // Use the real @tauri-apps/api/core — the Vite alias stops recursion because
  // this file's import path goes through node_modules directly.
  const mod = await import("../../node_modules/@tauri-apps/api/core.js");
  _invokeLocal = (cmd, args, options) => mod.invoke(cmd, args, options);
  _Channel = mod.Channel;
  _transformCallback = mod.transformCallback;
} else {
  _invokeLocal = browserInvoke;
  _Channel = BrowserChannel as never;
  _transformCallback = browserTransformCallback;
}

export { _Channel as Channel, _transformCallback as transformCallback };

/** Handles `cmd` elsewhere, or returns null to run it in this process. */
export type InvokeRoute = (
  cmd: string,
  args?: Record<string, unknown>,
  options?: InvokeOptions,
) => Promise<unknown> | null;

let route: InvokeRoute | null = null;

export function setInvokeRoute(next: InvokeRoute | null) {
  route = next;
}

export function invokeLocal<T = unknown>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  return _invokeLocal<T>(cmd, args, options);
}

export function invoke<T>(cmd: string, args?: Record<string, unknown>, options?: InvokeOptions): Promise<T> {
  return (route?.(cmd, args, options) ?? _invokeLocal(cmd, args, options)) as Promise<T>;
}

export function isTauri(): boolean {
  return _isTauri;
}
