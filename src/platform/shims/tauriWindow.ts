/** Browser-mode shim for @tauri-apps/api/window. */

class BrowserWindow {
  readonly label = "main";
  async setTitle(_title: string) {}
  async show() {}
  async hide() {}
  async close() {}
  async setDecorations(_decorations: boolean) {}
  async setAlwaysOnTop(_alwaysOnTop: boolean) {}
  async setFullscreen(_fullscreen: boolean) {}
  async isFullscreen() { return false; }
  async isMaximized() { return false; }
  async isMinimized() { return false; }
  async minimize() {}
  async maximize() {}
  async unmaximize() {}
  async toggleMaximize() {}
  async center() {}
  async setFocus() { window.focus(); }
  async setResizable(_resizable: boolean) {}
  async setSize(_size: unknown) {}
  async setMinSize(_size: unknown) {}
  async innerSize() { return { width: window.innerWidth, height: window.innerHeight }; }
  async outerSize() { return { width: window.outerWidth, height: window.outerHeight }; }
  async innerPosition() { return { x: 0, y: 0 }; }
  async outerPosition() { return { x: window.screenX, y: window.screenY }; }
  async startResizeDragging(_direction: unknown) {}
  async startDragging() {}
  async onCloseRequested(_handler: (event: { preventDefault: () => void }) => void | Promise<void>) { return () => {}; }
  async onResized(_handler: () => void) { return () => {}; }
  async listen<T>(_event: string, _handler: (event: { payload: T }) => void) { return () => {}; }
  async once<T>(_event: string, _handler: (event: { payload: T }) => void) { return () => {}; }
}

const instance = new BrowserWindow();

export function getCurrentWindow(): BrowserWindow {
  return instance;
}

export { BrowserWindow as Window };
