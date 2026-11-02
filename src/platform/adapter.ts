/**
 * Frontend Platform Boundary & Adapter Interface.
 *
 * Replaces direct platform-specific access behind a small set of interfaces:
 * - Dialogs (open, save, ask, confirm, message)
 * - Opener (openUrl, revealItemInDir)
 * - Window management (title, maximize, minimize, close, etc.)
 * - Path operations (homeDir, appDataDir, join)
 * - Events (listen, emit, emitTo)
 *
 * In desktop/Tauri mode, operations route to the native Tauri runtime.
 * In browser mode, operations use browser APIs where available and report
 * unsupported states explicitly.
 */

import { isTauri } from "./ipc";
import { getCapability } from "./capabilities";

// ---------------------------------------------------------------------------
// Dialog Interfaces
// ---------------------------------------------------------------------------

export interface OpenDialogFilter {
  name: string;
  extensions: string[];
}

export interface PlatformOpenDialogOptions {
  title?: string;
  defaultPath?: string;
  multiple?: boolean;
  directory?: boolean;
  filters?: OpenDialogFilter[];
}

export interface PlatformSaveDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: OpenDialogFilter[];
}

export type PlatformDialogKind = "error" | "info" | "warning";
export interface PlatformDialogMessageOptions {
  title?: string;
  kind?: PlatformDialogKind;
}

export interface PlatformDialogAdapter {
  open(options?: PlatformOpenDialogOptions): Promise<string | string[] | null>;
  save(options?: PlatformSaveDialogOptions): Promise<string | null>;
  ask(message: string, options?: PlatformDialogMessageOptions): Promise<boolean>;
  confirm(message: string, options?: PlatformDialogMessageOptions): Promise<boolean>;
  message(message: string, options?: PlatformDialogMessageOptions): Promise<void>;
}

// ---------------------------------------------------------------------------
// Opener Interface
// ---------------------------------------------------------------------------

export interface PlatformOpenerAdapter {
  openUrl(url: string): Promise<void>;
  revealItemInDir(path: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Window Management Interface
// ---------------------------------------------------------------------------

export interface PlatformWindowAdapter {
  readonly label: string;
  setTitle(title: string): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  isFullscreen?(): Promise<boolean>;
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  unmaximize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  onCloseRequested(handler: (event: { preventDefault: () => void }) => void | Promise<void>): Promise<() => void>;
  onResized?(handler: () => void): Promise<() => void>;
  startResizeDragging?(direction: string): Promise<void>;
  startDragging?(): Promise<void>;
  setBackgroundColor?(color: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Path Interface
// ---------------------------------------------------------------------------

export interface PlatformPathAdapter {
  homeDir(): Promise<string>;
  appDataDir(): Promise<string>;
  join(...paths: string[]): Promise<string>;
}

// ---------------------------------------------------------------------------
// Event Bus Interface
// ---------------------------------------------------------------------------

export interface PlatformEventAdapter {
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
  emit(event: string, payload?: unknown): Promise<void>;
  emitTo(target: string, event: string, payload?: unknown): Promise<void>;
}

// ---------------------------------------------------------------------------
// Combined Platform Adapter
// ---------------------------------------------------------------------------

export interface PlatformAdapter {
  readonly isNative: boolean;
  readonly dialog: PlatformDialogAdapter;
  readonly opener: PlatformOpenerAdapter;
  readonly window: PlatformWindowAdapter;
  readonly path: PlatformPathAdapter;
  readonly events: PlatformEventAdapter;
}

// ---------------------------------------------------------------------------
// Tauri Desktop Implementation
// ---------------------------------------------------------------------------

class TauriPlatformAdapter implements PlatformAdapter {
  readonly isNative = true;

  readonly dialog: PlatformDialogAdapter = {
    async open(options) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      return open(options);
    },
    async save(options) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      return save(options);
    },
    async ask(msg, options) {
      const { ask } = await import("@tauri-apps/plugin-dialog");
      return ask(msg, options);
    },
    async confirm(msg, options) {
      const { confirm } = await import("@tauri-apps/plugin-dialog");
      return confirm(msg, options);
    },
    async message(msg, options) {
      const { message } = await import("@tauri-apps/plugin-dialog");
      await message(msg, options);
    },
  };

  readonly opener: PlatformOpenerAdapter = {
    async openUrl(url) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      return openUrl(url);
    },
    async revealItemInDir(path) {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      return revealItemInDir(path);
    },
  };

  readonly window: PlatformWindowAdapter = {
    get label() {
      return "main";
    },
    async setTitle(title) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return getCurrentWindow().setTitle(title);
    },
    async close() {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return getCurrentWindow().close();
    },
    async isMaximized() {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return getCurrentWindow().isMaximized();
    },
    async isFullscreen() {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return getCurrentWindow().isFullscreen();
    },
    async minimize() {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return getCurrentWindow().minimize();
    },
    async maximize() {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return getCurrentWindow().maximize();
    },
    async unmaximize() {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return getCurrentWindow().unmaximize();
    },
    async toggleMaximize() {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return getCurrentWindow().toggleMaximize();
    },
    async onCloseRequested(handler) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return getCurrentWindow().onCloseRequested(handler);
    },
    async onResized(handler) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return getCurrentWindow().onResized(handler);
    },
    async startResizeDragging(direction) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return (getCurrentWindow() as unknown as { startResizeDragging(d: string): Promise<void> }).startResizeDragging(
        direction,
      );
    },
    async startDragging() {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return (getCurrentWindow() as unknown as { startDragging(): Promise<void> }).startDragging();
    },
    async setBackgroundColor(color) {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      return (
        getCurrentWebviewWindow() as unknown as { setBackgroundColor(c: string): Promise<void> }
      ).setBackgroundColor(color);
    },
  };

  readonly path: PlatformPathAdapter = {
    async homeDir() {
      const { homeDir } = await import("@tauri-apps/api/path");
      return homeDir();
    },
    async appDataDir() {
      const { appDataDir } = await import("@tauri-apps/api/path");
      return appDataDir();
    },
    async join(...paths) {
      const { join } = await import("@tauri-apps/api/path");
      return join(...paths);
    },
  };

  readonly events: PlatformEventAdapter = {
    async listen<T>(event: string, handler: (payload: T) => void) {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<T>(event, ({ payload }) => handler(payload));
    },
    async emit(event, payload) {
      const { emit } = await import("@tauri-apps/api/event");
      return emit(event, payload);
    },
    async emitTo(target, event, payload) {
      const { emitTo } = await import("@tauri-apps/api/event");
      return emitTo(target, event, payload);
    },
  };
}

// ---------------------------------------------------------------------------
// Browser Implementation
// ---------------------------------------------------------------------------

class BrowserPlatformAdapter implements PlatformAdapter {
  readonly isNative = false;

  readonly dialog: PlatformDialogAdapter = {
    async open(_options) {
      console.warn("[browser] Native file open dialog is unsupported in the browser runtime.");
      return null;
    },
    async save(_options) {
      console.warn("[browser] Native file save dialog is unsupported in the browser runtime.");
      return null;
    },
    async ask(msg) {
      return typeof window !== "undefined" ? window.confirm(msg) : false;
    },
    async confirm(msg) {
      return typeof window !== "undefined" ? window.confirm(msg) : false;
    },
    async message(msg) {
      if (typeof window !== "undefined") window.alert(msg);
    },
  };

  readonly opener: PlatformOpenerAdapter = {
    async openUrl(url) {
      if (typeof window !== "undefined") {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    },
    async revealItemInDir(path) {
      console.warn(`[browser] Cannot reveal item "${path}": ${getCapability("filesystem").reason}`);
    },
  };

  readonly window: PlatformWindowAdapter = {
    get label() {
      return "main";
    },
    async setTitle(title) {
      if (typeof document !== "undefined") document.title = title;
    },
    async close() {
      if (typeof window !== "undefined") window.close();
    },
    async isMaximized() {
      return false;
    },
    async isFullscreen() {
      return false;
    },
    async minimize() {},
    async maximize() {},
    async unmaximize() {},
    async toggleMaximize() {},
    async onCloseRequested(_handler) {
      return () => {};
    },
    async onResized(handler) {
      if (typeof window !== "undefined") {
        window.addEventListener("resize", handler);
        return () => window.removeEventListener("resize", handler);
      }
      return () => {};
    },
  };

  readonly path: PlatformPathAdapter = {
    async homeDir() {
      return "/home/user";
    },
    async appDataDir() {
      return "/appdata";
    },
    async join(...paths) {
      return paths.filter(Boolean).join("/").replace(/\/+/g, "/");
    },
  };

  readonly events: PlatformEventAdapter = (() => {
    const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
    return {
      async listen<T>(event: string, handler: (payload: T) => void) {
        let set = eventListeners.get(event);
        if (!set) eventListeners.set(event, (set = new Set()));
        const h = handler as (payload: unknown) => void;
        set.add(h);
        return () => set.delete(h);
      },
      async emit(event, payload) {
        const set = eventListeners.get(event);
        if (set) {
          for (const h of set) {
            try {
              h(payload);
            } catch (e) {
              console.error(`Browser event handler for "${event}" failed:`, e);
            }
          }
        }
      },
      async emitTo(_target, event, payload) {
        return this.emit(event, payload);
      },
    };
  })();
}

// ---------------------------------------------------------------------------
// Singleton selection
// ---------------------------------------------------------------------------

let activeAdapter: PlatformAdapter | null = null;

export function getPlatform(): PlatformAdapter {
  if (!activeAdapter) {
    activeAdapter = isTauri() ? new TauriPlatformAdapter() : new BrowserPlatformAdapter();
  }
  return activeAdapter;
}

/** Override adapter for unit testing. */
export function setPlatformAdapterForTest(adapter: PlatformAdapter | null): void {
  activeAdapter = adapter;
}

// Convenient accessors
export const platformDialog = {
  open: (options?: PlatformOpenDialogOptions) => getPlatform().dialog.open(options),
  save: (options?: PlatformSaveDialogOptions) => getPlatform().dialog.save(options),
  ask: (msg: string, opt?: PlatformDialogMessageOptions) => getPlatform().dialog.ask(msg, opt),
  confirm: (msg: string, opt?: PlatformDialogMessageOptions) => getPlatform().dialog.confirm(msg, opt),
  message: (msg: string, opt?: PlatformDialogMessageOptions) => getPlatform().dialog.message(msg, opt),
};

export const platformOpener = {
  openUrl: (url: string) => getPlatform().opener.openUrl(url),
  revealItemInDir: (path: string) => getPlatform().opener.revealItemInDir(path),
};

export const platformWindow = {
  setTitle: (title: string) => getPlatform().window.setTitle(title),
  close: () => getPlatform().window.close(),
  isMaximized: () => getPlatform().window.isMaximized(),
  isFullscreen: () => {
    const platformWindow = getPlatform().window;
    return platformWindow.isFullscreen ? platformWindow.isFullscreen() : Promise.resolve(false);
  },
  minimize: () => getPlatform().window.minimize(),
  maximize: () => getPlatform().window.maximize(),
  unmaximize: () => getPlatform().window.unmaximize(),
  toggleMaximize: () => getPlatform().window.toggleMaximize(),
  onCloseRequested: (handler: (event: { preventDefault: () => void }) => void | Promise<void>) =>
    getPlatform().window.onCloseRequested(handler),
  onResized: (handler: () => void) => {
    const platformWindow = getPlatform().window;
    return platformWindow.onResized ? platformWindow.onResized(handler) : Promise.resolve(() => {});
  },
  startResizeDragging: (direction: string) => {
    const platformWindow = getPlatform().window;
    return platformWindow.startResizeDragging ? platformWindow.startResizeDragging(direction) : Promise.resolve();
  },
  setBackgroundColor: (color: string) => {
    const platformWindow = getPlatform().window;
    return platformWindow.setBackgroundColor ? platformWindow.setBackgroundColor(color) : Promise.resolve();
  },
};

export const platformPath = {
  homeDir: () => getPlatform().path.homeDir(),
  appDataDir: () => getPlatform().path.appDataDir(),
  join: (...paths: string[]) => getPlatform().path.join(...paths),
};

export const platformEvents = {
  listen: <T>(event: string, handler: (payload: T) => void) => getPlatform().events.listen<T>(event, handler),
  emit: (event: string, payload?: unknown) => getPlatform().events.emit(event, payload),
  emitTo: (target: string, event: string, payload?: unknown) => getPlatform().events.emitTo(target, event, payload),
};
