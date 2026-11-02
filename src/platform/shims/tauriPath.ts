/** Browser-mode shim for @tauri-apps/api/path. */

export async function homeDir(): Promise<string> {
  return "/home/user";
}

export async function appDataDir(): Promise<string> {
  return "/appdata";
}

export async function join(...paths: string[]): Promise<string> {
  return paths.filter(Boolean).join("/").replace(/\/+/g, "/");
}

export async function resolve(...paths: string[]): Promise<string> {
  return join(...paths);
}

export async function basename(path: string, ext?: string): Promise<string> {
  const base = path.split("/").pop() ?? path;
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

export async function dirname(path: string): Promise<string> {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/") || "/";
}

export async function extname(path: string): Promise<string> {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

export const sep = "/";
export const delimiter = ":";
