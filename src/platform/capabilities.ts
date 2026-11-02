/**
 * Feature Capability Registry.
 *
 * Central registry that describes which IDE features are available, unsupported,
 * or require permission in the current runtime (Tauri desktop vs browser).
 * Components query capabilities to gate feature access, and the UI reacts to
 * changes (e.g. a browser permission grant) via the `useCapability` hook.
 */
import { create } from "zustand";
import { isTauri } from "@/platform/ipc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CapabilityState = "available" | "unsupported" | "permission-required";

export interface Capability {
  state: CapabilityState;
  /** Explains why a capability is unavailable or requires permission. */
  reason?: string;
}

export type CapabilityId =
  // Native-only features
  | "filesystem"
  | "filesystem.watch"
  | "process"
  | "terminal"
  | "lsp"
  | "dap"
  | "vcs"
  | "ssh"
  | "docker"
  | "database"
  | "clipboard.native"
  | "window.native"
  | "dialog.native"
  | "path.native"
  | "http.unrestricted"
  | "systemFonts"
  // Browser-available features
  | "clipboard.basic"
  | "dialog.browser"
  | "storage.indexeddb"
  | "storage.opfs";

// ---------------------------------------------------------------------------
// Capability map
// ---------------------------------------------------------------------------

function available(): Capability {
  return { state: "available" };
}

function unsupported(reason: string): Capability {
  return { state: "unsupported", reason };
}

function permissionRequired(reason: string): Capability {
  return { state: "permission-required", reason };
}

function buildCapabilities(): Map<CapabilityId, Capability> {
  const tauri = isTauri();
  const map = new Map<CapabilityId, Capability>();

  if (tauri) {
    // In Tauri every feature is available.
    const ids: CapabilityId[] = [
      "filesystem",
      "filesystem.watch",
      "process",
      "terminal",
      "lsp",
      "dap",
      "vcs",
      "ssh",
      "docker",
      "database",
      "clipboard.native",
      "window.native",
      "dialog.native",
      "path.native",
      "http.unrestricted",
      "systemFonts",
      "clipboard.basic",
      "dialog.browser",
      "storage.indexeddb",
      "storage.opfs",
    ];
    for (const id of ids) map.set(id, available());
  } else {
    // Native features are unavailable in the browser.
    map.set(
      "filesystem",
      permissionRequired("Select files explicitly; direct writes require File System Access API permission"),
    );
    map.set("filesystem.watch", unsupported("File system watchers require a native runtime"));
    map.set("process", unsupported("Spawning processes requires a native runtime"));
    map.set("terminal", unsupported("PTY/terminal requires a native runtime"));
    map.set("lsp", unsupported("Language Server Protocol requires a native runtime"));
    map.set("dap", unsupported("Debug Adapter Protocol requires a native runtime"));
    map.set("vcs", unsupported("Git integration requires a native runtime"));
    map.set("ssh", unsupported("SSH connections require a native runtime"));
    map.set("docker", unsupported("Docker integration requires a native runtime"));
    map.set("database", unsupported("Native database drivers require a native runtime"));
    map.set("clipboard.native", unsupported("Native clipboard with rich formats requires a native runtime"));
    map.set("window.native", unsupported("Native window management requires a native runtime"));
    map.set("dialog.native", unsupported("Native file dialogs require a native runtime"));
    map.set("path.native", unsupported("Native path resolution requires a native runtime"));
    map.set("http.unrestricted", unsupported("Unrestricted HTTP requires a native runtime to bypass CORS"));
    map.set("systemFonts", unsupported("Enumerating system fonts requires a native runtime"));

    // Browser-provided features are available.
    map.set("clipboard.basic", available());
    map.set("dialog.browser", available());
    map.set(
      "storage.indexeddb",
      typeof indexedDB !== "undefined" ? available() : unsupported("IndexedDB is unavailable in this browser context"),
    );
    const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
    map.set(
      "storage.opfs",
      typeof storage?.getDirectory === "function"
        ? available()
        : unsupported("Origin Private File System is unavailable in this browser"),
    );
  }

  return map;
}

const capabilities: Map<CapabilityId, Capability> = buildCapabilities();

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

const UNKNOWN: Capability = { state: "unsupported", reason: "Unknown capability" };

/** Returns the {@link Capability} descriptor for the given feature. */
export function getCapability(id: CapabilityId): Capability {
  return capabilities.get(id) ?? UNKNOWN;
}

/** `true` when the feature is fully available in the current runtime. */
export function isAvailable(id: CapabilityId): boolean {
  return getCapability(id).state === "available";
}

/** `true` when the feature cannot be used in the current runtime. */
export function isUnsupported(id: CapabilityId): boolean {
  return getCapability(id).state === "unsupported";
}

/** `true` when the feature needs an explicit user permission grant. */
export function requiresPermission(id: CapabilityId): boolean {
  return getCapability(id).state === "permission-required";
}

/** Returns the human-readable reason a capability is unavailable, if any. */
export function getUnsupportedReason(id: CapabilityId): string | undefined {
  return getCapability(id).reason;
}

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

/**
 * Transitions a `permission-required` capability to `available`.
 *
 * Call this after the user grants access (e.g. browser File System Access API).
 * No-op if the capability is already `available` or `unsupported`.
 */
export function grantCapability(id: CapabilityId): void {
  const cap = capabilities.get(id);
  if (!cap || cap.state !== "permission-required") return;
  const granted: Capability = { state: "available" };
  capabilities.set(id, granted);
  useCapabilityStore.setState((prev) => ({ ...prev, [id]: granted }));
}

// ---------------------------------------------------------------------------
// Reactive store (zustand)
// ---------------------------------------------------------------------------

type CapabilityStore = Record<CapabilityId, Capability>;

function buildStoreState(): CapabilityStore {
  const state = {} as Record<string, Capability>;
  for (const [id, cap] of capabilities) state[id] = cap;
  return state as CapabilityStore;
}

const useCapabilityStore = create<CapabilityStore>(() => buildStoreState());

/** React hook — re-renders when the capability's state changes. */
export function useCapability(id: CapabilityId): Capability {
  return useCapabilityStore((s) => s[id] ?? UNKNOWN);
}
