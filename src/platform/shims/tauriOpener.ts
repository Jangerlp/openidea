/** Browser-mode shim for @tauri-apps/plugin-opener. */

export async function openUrl(url: string): Promise<void> {
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function revealItemInDir(_path: string): Promise<void> {
  console.warn("[browser] Cannot reveal files in directory: native filesystem access is not available.");
}
