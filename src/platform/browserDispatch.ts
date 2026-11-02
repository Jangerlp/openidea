/**
 * Browser Command Dispatcher.
 *
 * Handles backend IPC commands entirely within the browser environment.
 * Pure vertical slice commands are processed locally, while unsupported native
 * commands reject with a typed `unavailable` IdeError.
 */

import type { AppInfo, IdeError } from "@/bindings";
import { isTauri } from "./ipc";
import { setInvokeRoute } from "./tauriCore";
import type { StreamChannel } from "./stream";

export type BrowserCommandHandler<TArgs = unknown, TResult = unknown> = (args: TArgs) => Promise<TResult> | TResult;

const handlers = new Map<string, BrowserCommandHandler<any, any>>();
const cancelledRequests = new Set<number>();

/**
 * Registers a browser-side command handler for command `name` (e.g. `app_info`).
 * Returns an unregister function.
 */
export function registerBrowserCommand<TArgs = unknown, TResult = unknown>(
  name: string,
  handler: BrowserCommandHandler<TArgs, TResult>,
): () => void {
  handlers.set(name, handler);
  return () => {
    if (handlers.get(name) === handler) handlers.delete(name);
  };
}

/**
 * Dispatches an IPC command invocation in the browser.
 * If the command is registered, invokes its handler.
 * If not, rejects with a typed `unavailable` IdeError.
 */
export async function dispatchBrowserCommand<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const handler = handlers.get(cmd);
  if (handler) {
    try {
      return (await handler(args)) as T;
    } catch (error) {
      if (error && typeof error === "object" && "kind" in error) {
        throw error;
      }
      const ideError: IdeError = {
        kind: "unknown",
        message: error instanceof Error ? error.message : String(error),
        data: null,
      };
      throw ideError;
    }
  }

  // Reject unsupported command with explicit typed unavailable error
  const ideError: IdeError = {
    kind: "unavailable",
    message: `Command "${cmd}" is not available in browser mode.`,
    data: { command: cmd },
  };
  throw ideError;
}

// ---------------------------------------------------------------------------
// Pure Vertical Slice Built-in Handlers
// ---------------------------------------------------------------------------

function registerDefaultHandlers() {
  // App metadata
  registerBrowserCommand<void, AppInfo>("app_info", () => ({
    name: "OpenIDEA Web",
    version: "0.1.34-web",
    platform: "web",
    arch: "wasm32",
    family: "unix",
    configDir: "/config",
    dataDir: "/data",
    cacheDir: "/cache",
    logDir: "/logs",
  }));

  // Request cancellation
  registerBrowserCommand<{ id: number }, null>("cancel_request", (args) => {
    if (args && typeof args.id === "number") {
      cancelledRequests.add(args.id);
    }
    return null;
  });

  registerBrowserCommand<{ id: number }, boolean>("is_request_cancelled", (args) => {
    return args && typeof args.id === "number" ? cancelledRequests.has(args.id) : false;
  });

  // Pure byte computation
  registerBrowserCommand<{ bytes: number }, string>("bytes_format", ({ bytes }) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  });

  // Echo test command
  registerBrowserCommand<{ message: string }, string>("echo", ({ message }) => message);

  // Pure stream test command
  registerBrowserCommand<
    { channel: StreamChannel<string> | { onmessage: (data: string) => void }; count?: number },
    { total: number }
  >("stream_echo", ({ channel, count = 3 }) => {
    for (let i = 1; i <= count; i++) {
      if ("send" in channel && typeof channel.send === "function") {
        channel.send(`chunk-${i}`);
      } else if (channel.onmessage) {
        channel.onmessage(`chunk-${i}`);
      }
    }
    return { total: count };
  });
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

registerDefaultHandlers();

/** Installs the browser dispatcher as the active invoke route. */
export function installBrowserDispatch(): () => void {
  setInvokeRoute((cmd, args) => dispatchBrowserCommand(cmd, args));
  return () => setInvokeRoute(null);
}

// Auto-install in browser runtime
if (!isTauri()) {
  installBrowserDispatch();
}
