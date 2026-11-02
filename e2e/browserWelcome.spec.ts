import { expect, test } from "@playwright/test";

test("opens, restores and removes a recent browser file without deleting its contents", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined });
  });

  await page.goto("/");
  await expect(
    page.getByText("Open files from your device. Opening project folders requires the desktop app."),
  ).toBeVisible();

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open files" }).click();
  await (
    await chooser
  ).setFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("recent browser file"),
  });

  const tab = page.getByRole("tablist", { name: "Editor tabs" }).getByRole("tab", { name: "notes.txt" });
  await expect(tab).toBeVisible();
  await expect(page.locator(".cm-content").first()).toContainText("recent browser file");

  await page.reload();
  const recentFile = page.getByRole("option").filter({ hasText: "notes.txt" });
  await expect(recentFile).toBeVisible();
  await recentFile.click();
  await expect(tab).toBeVisible();
  await expect(page.locator(".cm-content").first()).toContainText("recent browser file");

  await page.reload();
  const restoredFile = page.getByRole("option").filter({ hasText: "notes.txt" });
  await expect(restoredFile).toBeVisible();
  await restoredFile.getByRole("button", { name: "File actions" }).click();
  await page.getByRole("menuitem", { name: "Remove from Recent Files…" }).click();
  const confirm = page.getByRole("dialog", { name: "Remove Recent File" });
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("option").filter({ hasText: "notes.txt" })).toHaveCount(0);

  const stored = await page.evaluate(
    () =>
      new Promise<unknown[]>((resolve, reject) => {
        const request = indexedDB.open("openidea-browser-files", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction("documents", "readonly");
          const getAll = transaction.objectStore("documents").getAll();
          getAll.onsuccess = () => resolve(getAll.result);
          getAll.onerror = () => reject(getAll.error);
        };
      }),
  );
  expect(stored).toContainEqual(
    expect.objectContaining({ name: "notes.txt", text: "recent browser file", recent: false }),
  );
  expect(errors).toEqual([]);
});
