import { describe, expect, it, vi } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import {
  BrowserFileError,
  BrowserFileSystem,
  type BrowserDocumentStore,
  type BrowserFileHandle,
  type BrowserFileRuntime,
  type StoredDocument,
  createBrowserFileSystem,
} from "./browserFileSystem";
import { createBrowserDocBackend } from "@/editor/core/backend";

class MemoryDocumentStore implements BrowserDocumentStore {
  readonly documents = new Map<string, StoredDocument>();

  async get(id: string) {
    return this.documents.get(id);
  }

  async getAll() {
    return [...this.documents.values()];
  }

  async put(document: StoredDocument) {
    this.documents.set(document.id, document);
  }
}

function runtime(overrides: Partial<BrowserFileRuntime> = {}): BrowserFileRuntime {
  return {
    store: new MemoryDocumentStore(),
    now: () => 123,
    createId: vi.fn(() => "doc-1"),
    download: vi.fn(),
    ...overrides,
  };
}

function fileHandle(permission: PermissionState = "granted", requestedPermission: PermissionState = permission) {
  let contents = "original";
  const handle: BrowserFileHandle = {
    name: "notes.txt",
    getFile: async () => new File([contents], "notes.txt", { type: "text/plain" }),
    queryPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => requestedPermission),
    createWritable: vi.fn(async () => ({
      write: async (text: string) => {
        contents = text;
      },
      close: async () => {},
    })),
  };
  return { handle, contents: () => contents };
}

describe("BrowserFileSystem", () => {
  it("opens, edits and saves a user-selected file through its granted handle", async () => {
    const file = fileHandle();
    const win = { showOpenFilePicker: vi.fn(async () => [file.handle]) } as unknown as BrowserFileRuntime["window"];
    const runtimeDeps = runtime({ window: win });
    const fs = new BrowserFileSystem(runtimeDeps);

    const [opened] = await fs.openTextFiles();
    expect(opened).toMatchObject({ name: "notes.txt", text: "original", canWriteToSource: true });
    await expect(fs.read(opened!.id)).resolves.toMatchObject({ text: "original" });
    await expect(fs.save(opened!.id, "edited")).resolves.toBe("source");
    expect(file.contents()).toBe("edited");
  });

  it("uses the adapter for editor open, edit and save", async () => {
    const file = fileHandle();
    const deps = runtime({
      window: { showOpenFilePicker: async () => [file.handle] } as unknown as BrowserFileRuntime["window"],
    });
    const fs = new BrowserFileSystem(deps);
    const [selected] = await fs.openTextFiles();
    const backend = createBrowserDocBackend(fs);
    const document = await backend.open(selected!.path);

    await backend.edit(document.id, document.version, [{ from: 0, to: document.text.length, insert: "edited" }]);
    await backend.save(document.id);

    expect(file.contents()).toBe("edited");
  });

  it("keeps edits in IndexedDB when a revoked source handle is denied again", async () => {
    const file = fileHandle("prompt", "denied");
    const runtimeDeps = runtime({
      window: { showOpenFilePicker: async () => [file.handle] } as unknown as BrowserFileRuntime["window"],
    });
    const fs = new BrowserFileSystem(runtimeDeps);
    const [opened] = await fs.openTextFiles();

    await expect(fs.save(opened!.id, "draft")).rejects.toMatchObject({
      kind: "permissionDenied",
      message: expect.stringContaining("remain in browser storage"),
    } satisfies Partial<BrowserFileError>);
    await expect(fs.read(opened!.id)).resolves.toMatchObject({ text: "draft" });
  });

  it("downloads edits when no persistent source handle is available", async () => {
    const deps = runtime();
    const fs = new BrowserFileSystem(deps);
    await fs.importAll(
      JSON.stringify({
        format: "openidea-browser-files",
        version: 1,
        documents: [{ id: "imported", name: "notes.txt", text: "before", updatedAt: 1 }],
      }),
    );

    await expect(fs.save("imported", "after")).resolves.toBe("download");
    expect(deps.download).toHaveBeenCalledWith("notes.txt", "after");
    await expect(fs.read("imported")).resolves.toMatchObject({ text: "after", canWriteToSource: false });
  });

  it("uses the file-input fallback when the File System Access API is absent", async () => {
    const file = new File(["fallback text"], "fallback.txt", { type: "text/plain" });
    const listeners = new Map<string, EventListener>();
    const input = {
      files: [file],
      addEventListener: (type: string, handler: EventListener) => listeners.set(type, handler),
      click: () => listeners.get("change")?.(new Event("change")),
    } as unknown as HTMLInputElement;
    const deps = runtime({
      document: { createElement: () => input } as unknown as Document,
    });
    const fs = new BrowserFileSystem(deps);

    const [opened] = await fs.openTextFiles();
    expect(opened).toMatchObject({ name: "fallback.txt", text: "fallback text", canWriteToSource: false });
    await expect(fs.save(opened!.id, "changed")).resolves.toBe("download");
    expect(deps.download).toHaveBeenCalledWith("fallback.txt", "changed");
  });

  it("exports and imports persisted documents without exporting file handles", async () => {
    const file = fileHandle();
    const deps = runtime({
      window: { showOpenFilePicker: async () => [file.handle] } as unknown as BrowserFileRuntime["window"],
    });
    const fs = new BrowserFileSystem(deps);
    await fs.openTextFiles();
    const exported = await fs.exportAll();
    expect(exported).toContain('"format":"openidea-browser-files"');
    expect(exported).not.toContain("handle");
    await expect(new BrowserFileSystem(deps).list()).resolves.toHaveLength(1);

    const restoredDeps = runtime();
    const restored = new BrowserFileSystem(restoredDeps);
    expect(await restored.importAll(exported)).toBe(1);
    await expect(restored.list()).resolves.toMatchObject([
      { name: "notes.txt", text: "original", canWriteToSource: false },
    ]);
  });

  it("removes a file from recents without deleting its saved content", async () => {
    const store = new MemoryDocumentStore();
    const fs = new BrowserFileSystem(runtime({ store }));
    await fs.importAll(
      JSON.stringify({
        format: "openidea-browser-files",
        version: 1,
        documents: [{ id: "remove-me", name: "notes.txt", text: "saved", updatedAt: 1 }],
      }),
    );

    await fs.remove("remove-me");

    await expect(fs.list()).resolves.not.toContainEqual(expect.objectContaining({ id: "delete-from-idb" }));
    await expect(fs.read("remove-me")).resolves.toMatchObject({ text: "saved" });
  });

  it("persists browser documents across adapter instances in IndexedDB", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDB);
    try {
      const first = createBrowserFileSystem();
      await first.importAll(
        JSON.stringify({
          format: "openidea-browser-files",
          version: 1,
          documents: [{ id: "persistent", name: "persisted.md", text: "saved text", updatedAt: 123 }],
        }),
      );

      await expect(createBrowserFileSystem().list()).resolves.toMatchObject([
        { id: "persistent", name: "persisted.md", text: "saved text" },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("persists recent-file removal in IndexedDB without deleting the document", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDB);
    try {
      const fs = createBrowserFileSystem();
      await fs.importAll(
        JSON.stringify({
          format: "openidea-browser-files",
          version: 1,
          documents: [{ id: "delete-from-idb", name: "delete.txt", text: "saved", updatedAt: 123 }],
        }),
      );

      await fs.remove("delete-from-idb");

      await expect(fs.list()).resolves.not.toContainEqual(expect.objectContaining({ id: "delete-from-idb" }));
      await expect(fs.read("delete-from-idb")).resolves.toMatchObject({ text: "saved" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("surfaces quota exhaustion instead of reporting a successful import", async () => {
    const store = new MemoryDocumentStore();
    store.put = async () => {
      throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    };
    const fs = new BrowserFileSystem(runtime({ store }));
    await expect(
      fs.importAll(
        JSON.stringify({
          format: "openidea-browser-files",
          version: 1,
          documents: [{ id: "large", name: "large.txt", text: "content", updatedAt: 123 }],
        }),
      ),
    ).rejects.toMatchObject({
      kind: "storage",
      message: expect.stringContaining("storage is full"),
    });
  });

  it("rejects malformed or unsupported import formats", async () => {
    const fs = new BrowserFileSystem(runtime());
    await expect(fs.importAll("{")).rejects.toMatchObject({ kind: "invalidData" });
    await expect(
      fs.importAll(JSON.stringify({ format: "openidea-browser-files", version: 2, documents: [] })),
    ).rejects.toMatchObject({ kind: "invalidData" });
  });
});
