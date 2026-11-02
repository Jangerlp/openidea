/** Browser-mode shim for @tauri-apps/api/webview. */

class BrowserWebview {
  readonly label = "main";
  async listen<T>(_event: string, _handler: (event: { payload: T }) => void) { return () => {}; }
  async once<T>(_event: string, _handler: (event: { payload: T }) => void) { return () => {}; }
  async onDragDropEvent(_handler: (event: { payload: unknown }) => void) { return () => {}; }
  async setZoom(_zoom: number) {}
}

const instance = new BrowserWebview();

export function getCurrentWebview(): BrowserWebview {
  return instance;
}

export { BrowserWebview as Webview };
