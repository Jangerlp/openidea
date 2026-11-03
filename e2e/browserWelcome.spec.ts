import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("opens, restores and removes a recent browser file without deleting its contents", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined });
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: undefined });
  });

  await page.goto("/");
  await expect(
    page.getByText("Open files or create a browser workspace; native project tools require the desktop app."),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Browser workspaces" })).toBeVisible();
  await page.getByRole("region", { name: "Browser workspaces" }).getByRole("button", { name: "New Workspace" }).click();
  const workspaceDialog = page.getByRole("dialog", { name: "New Browser Workspace" });
  await workspaceDialog.getByRole("button", { name: "Add folder" }).click();
  await expect(workspaceDialog.getByRole("alert")).toContainText("File System Access API");
  await workspaceDialog.getByRole("button", { name: "Cancel" }).click();

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
        const request = indexedDB.open("openidea-browser-files");
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

test("creates a persistent multi-root browser workspace and saves a file to its source", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const firstRoot = `workspace-app-${suffix}`;
  const secondRoot = `workspace-shared-${suffix}`;
  const replacementRoot = `workspace-reconnected-${suffix}`;
  await page.addInitScript(
    async ({ firstRoot, secondRoot, replacementRoot }) => {
      const root = await navigator.storage.getDirectory();
      const roots = await Promise.all([
        root.getDirectoryHandle(firstRoot, { create: true }),
        root.getDirectoryHandle(secondRoot, { create: true }),
        root.getDirectoryHandle(replacementRoot, { create: true }),
      ]);
      const sourceFile = await roots[0]!.getFileHandle("main.ts", { create: true });
      if ((await sourceFile.getFile()).size === 0) {
        const writer = await sourceFile.createWritable();
        await writer.write("export const answer = 42;");
        await writer.close();
      }
      const sharedFile = await roots[1]!.getFileHandle("shared.md", { create: true });
      if ((await sharedFile.getFile()).size === 0) {
        const writer = await sharedFile.createWritable();
        await writer.write("# Shared notes");
        await writer.close();
      }
      const replacementFile = await roots[2]!.getFileHandle("main.ts", { create: true });
      if ((await replacementFile.getFile()).size === 0) {
        const writer = await replacementFile.createWritable();
        await writer.write("export const answer = 84;");
        await writer.close();
      }

      const pickerWindow = window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
      let nextRoot = sessionStorage.getItem("reconnect-workspace-root") ? 2 : 0;
      Object.defineProperty(pickerWindow, "showDirectoryPicker", {
        configurable: true,
        value: async () => {
          const selected = roots[nextRoot++];
          if (!selected) throw new DOMException("No test folder available", "AbortError");
          return selected;
        },
      });
    },
    { firstRoot, secondRoot, replacementRoot },
  );

  await page.goto("/");
  const workspaces = page.getByRole("region", { name: "Browser workspaces" });
  await workspaces.getByRole("button", { name: "New Workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "New Browser Workspace" });
  await dialog.getByRole("textbox", { name: "Workspace name" }).fill("Browser Multi-Root");
  await dialog.getByRole("button", { name: "Add folder" }).click();
  await expect(dialog.getByText(firstRoot)).toBeVisible();
  await dialog.getByRole("button", { name: "Add folder" }).click();
  await expect(dialog.getByText(secondRoot)).toBeVisible();
  await dialog.getByRole("button", { name: "Create" }).click();

  await expect(
    workspaces.getByRole("list", { name: "Workspace files" }).getByRole("button", { name: "main.ts" }),
  ).toBeVisible();
  await workspaces.getByRole("button", { name: "Workspaces" }).click();
  const workspaceCard = workspaces.locator("article").filter({ hasText: "Browser Multi-Root" });
  await expect(workspaceCard.getByText("2 folders")).toBeVisible();
  await workspaceCard.getByRole("button", { name: "Open" }).click();
  await workspaces.getByLabel("Workspace folder").selectOption({ label: secondRoot });
  await expect(
    workspaces.getByRole("list", { name: "Workspace files" }).getByRole("button", { name: "shared.md" }),
  ).toBeVisible();

  await workspaces.getByLabel("Workspace folder").selectOption({ label: firstRoot });
  await workspaces.getByRole("list", { name: "Workspace files" }).getByRole("button", { name: "main.ts" }).click();
  const tab = page.getByRole("tablist", { name: "Editor tabs" }).getByRole("tab", { name: "main.ts" });
  await expect(tab).toBeVisible();
  const editor = page.locator(".cm-content").first();
  await expect(editor).toContainText("answer = 42");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("export const answer = 84;");
  await page.keyboard.press("Control+S");
  await expect
    .poll(() =>
      page.evaluate(
        async ({ firstRoot }) => {
          const root = await navigator.storage.getDirectory();
          const directory = await root.getDirectoryHandle(firstRoot);
          const file = await directory.getFileHandle("main.ts");
          return file
            .getFile()
            .then((source) => source.text().then((text) => text.trim()))
            .catch((error: DOMException) => `error:${error.name}`);
        },
        { firstRoot },
      ),
    )
    .toBe("export const answer = 84;");

  await page.evaluate(() => sessionStorage.setItem("reconnect-workspace-root", "yes"));
  await page.reload();
  const restoredWorkspaces = page.getByRole("region", { name: "Browser workspaces" });
  const restoredCard = restoredWorkspaces.locator("article").filter({ hasText: "Browser Multi-Root" });
  await expect(restoredCard.getByText("2 folders")).toBeVisible();
  await expect(restoredCard.getByText("Read access granted")).toHaveCount(2);
  await restoredCard.getByRole("button", { name: "Change folder" }).first().click();
  await expect(restoredCard.getByText(replacementRoot)).toBeVisible();
  await expect(restoredCard.getByText("Read access granted")).toHaveCount(2);
  await expect(restoredCard.getByText("Write access granted")).toHaveCount(2);
  await restoredCard.getByRole("button", { name: "Open" }).click();
  await expect(
    restoredWorkspaces.getByRole("list", { name: "Workspace files" }).getByRole("button", { name: "main.ts" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("creates a text file in a browser workspace and saves edits to the new source", async ({ page }) => {
  const firstRoot = `workspace-create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.addInitScript(
    async ({ firstRoot }) => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(firstRoot, { create: true });
      const pickerWindow = window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
      Object.defineProperty(pickerWindow, "showDirectoryPicker", {
        configurable: true,
        value: async () => directory,
      });
    },
    { firstRoot },
  );

  await page.goto("/");
  const workspaces = page.getByRole("region", { name: "Browser workspaces" });
  await workspaces.getByRole("button", { name: "New Workspace" }).click();
  const workspaceDialog = page.getByRole("dialog", { name: "New Browser Workspace" });
  await workspaceDialog.getByRole("textbox", { name: "Workspace name" }).fill("Create File Workspace");
  await workspaceDialog.getByRole("button", { name: "Add folder" }).click();
  await expect(workspaceDialog.getByText(firstRoot)).toBeVisible();
  await workspaceDialog.getByRole("button", { name: "Create" }).click();

  await workspaces.getByRole("button", { name: "New File" }).click();
  const newFileDialog = page.getByRole("dialog", { name: "New Workspace File" });
  await newFileDialog.getByRole("textbox", { name: "Workspace file name" }).fill("created.md");
  await newFileDialog.getByRole("button", { name: "Create" }).click();
  const createdTab = page.getByRole("tablist", { name: "Editor tabs" }).getByRole("tab", { name: "created.md" });
  await expect(createdTab).toBeVisible();
  await page.locator(".cm-content").first().click();
  await page.keyboard.type("# Created from browser");
  await page.keyboard.press("Control+S");
  await expect
    .poll(() =>
      page.evaluate(
        async ({ firstRoot }) => {
          const root = await navigator.storage.getDirectory();
          const directory = await root.getDirectoryHandle(firstRoot);
          const file = await directory.getFileHandle("created.md");
          return file.getFile().then((source) => source.text().then((text) => text.trim()));
        },
        { firstRoot },
      ),
    )
    .toBe("# Created from browser");
});

test("imports and exports browser file backups without serializing source handles", async ({ page }) => {
  const fileId = `backup-${Date.now()}`;
  const backup = {
    format: "openidea-browser-files",
    version: 1,
    documents: [{ id: fileId, name: "portable.md", text: "portable document", updatedAt: Date.now() }],
  };
  await page.goto("/");

  const workspaces = page.getByRole("region", { name: "Browser workspaces" });
  await workspaces.getByLabel("Import browser file backup").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  const recent = page.getByRole("option").filter({ hasText: "portable.md" });
  await expect(recent).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await workspaces.getByRole("button", { name: "Export saved browser files" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("openidea-browser-files.json");
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const exported = JSON.parse(await readFile(downloadPath!, "utf8")) as {
    format: string;
    version: number;
    documents: Array<Record<string, unknown>>;
  };
  expect(exported).toMatchObject({ format: "openidea-browser-files", version: 1 });
  expect(exported.documents).toContainEqual(
    expect.objectContaining({ id: fileId, name: "portable.md", text: "portable document" }),
  );
  expect(JSON.stringify(exported)).not.toContain("handle");
  await recent.click();
  await expect(page.locator(".cm-content").first()).toContainText("portable document");
});
