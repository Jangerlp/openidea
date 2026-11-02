/** Browser-mode shim for @tauri-apps/plugin-dialog. */

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  multiple?: boolean;
  directory?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

export async function open(_options?: OpenDialogOptions): Promise<string | string[] | null> {
  // In a future PR, this will use the File System Access API.
  console.warn("[browser] Native file dialog is not available. Use the browser file picker instead.");
  return null;
}

export async function save(_options?: SaveDialogOptions): Promise<string | null> {
  console.warn("[browser] Native save dialog is not available.");
  return null;
}

export async function ask(_message: string, _options?: { title?: string; kind?: string }): Promise<boolean> {
  return window.confirm(_message);
}

export async function confirm(_message: string, _options?: { title?: string; kind?: string }): Promise<boolean> {
  return window.confirm(_message);
}

export async function message(_message: string, _options?: { title?: string; kind?: string }): Promise<void> {
  window.alert(_message);
}
