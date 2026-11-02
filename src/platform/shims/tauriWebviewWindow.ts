/** Browser-mode shim for @tauri-apps/api/webviewWindow. */

class BrowserWebviewWindow {
  readonly label = "main";
  async listen<T>(_event: string, _handler: (event: { payload: T }) => void) { return () => {}; }
  async once<T>(_event: string, _handler: (event: { payload: T }) => void) { return () => {}; }
  async emit(_event: string, _payload?: unknown) {}
  async setTitle(_title: string) {}
  async show() {}
  async hide() {}
  async close() {}
  async isMaximized() { return false; }
  async isMinimized() { return false; }
  async minimize() {}
  async maximize() {}
  async unmaximize() {}
  async toggleMaximize() {}
  async setFocus() { window.focus(); }
  async setBackgroundColor(_color: unknown) {}
  async innerSize() { return { width: window.innerWidth, height: window.innerHeight }; }
}

const instance = new BrowserWebviewWindow();

export function getCurrentWebviewWindow(): BrowserWebviewWindow {
  return instance;
}

export { BrowserWebviewWindow as WebviewWindow };
