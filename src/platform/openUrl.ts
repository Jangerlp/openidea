import { platformOpener } from "./adapter";

/** Opens a web or `mailto:` URL with the system handler (the default browser). */
export async function openExternalUrl(url: string): Promise<void> {
  await platformOpener.openUrl(url);
}
