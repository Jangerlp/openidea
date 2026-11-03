import { describe, expect, it, vi } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import {
  BrowserFileError,
  BrowserFileSystem,
  type BrowserDocumentStore,
  type BrowserDirectoryHandle,
  type BrowserFileHandle,
  type BrowserFileRuntime,
  type BrowserWorkspaceEntryHandle,
  type BrowserWorkspaceStore,
  type StoredWorkspace,
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

class MemoryWorkspaceStore implements BrowserWorkspaceStore {
  readonly workspaces = new Map<string, StoredWorkspace>();

  async get(id: string) {
    return this.workspaces.get(id);
  }

  async getAll() {
    return [...this.workspaces.values()];
  }

  async put(workspace: StoredWorkspace) {
    this.workspaces.set(workspace.id, workspace);
  }

  async delete(id: string) {
    this.workspaces.delete(id);
  }
}

interface MockDirectory {
  handle: BrowserDirectoryHandle;
  files: Map<string, ReturnType<typeof fileHandle>>;
  directories: Map<string, MockDirectory>;
}

function runtime(overrides: Partial<BrowserFileRuntime> = {}): BrowserFileRuntime {
  return {
    store: new MemoryDocumentStore(),
    workspaces: new MemoryWorkspaceStore(),
    now: () => 123,
    createId: vi.fn(() => "doc-1"),
    download: vi.fn(),
    ...overrides,
  };
}

function directoryHandle(
  name: string,
  contents: Record<string, string | Record<string, string>>,
  permission: PermissionState = "granted",
  requestedPermission: PermissionState = permission,
): MockDirectory {
  const files = new Map<string, ReturnType<typeof fileHandle>>();
  const directories = new Map<string, ReturnType<typeof directoryHandle>>();
  for (const [entryName, value] of Object.entries(contents)) {
    if (typeof value === "string") files.set(entryName, fileHandle(permission, requestedPermission, entryName, value));
    else directories.set(entryName, directoryHandle(entryName, value, permission, requestedPermission));
  }

  const handle: BrowserDirectoryHandle = {
    kind: "directory",
    name,
    values: async function* (): AsyncGenerator<BrowserWorkspaceEntryHandle> {
      for (const dir of directories.values()) yield dir.handle;
      for (const file of files.values()) yield file.handle;
    },
    getDirectoryHandle: async (entryName) => {
      const directory = directories.get(entryName);
      if (!directory) throw new DOMException("Directory not found", "NotFoundError");
      return directory.handle;
    },
    getFileHandle: async (entryName, options) => {
      const file = files.get(entryName);
      if (!file && options?.create) {
        const created = fileHandle(permission, requestedPermission, entryName, "");
        files.set(entryName, created);
        return created.handle;
      }
      if (!file) throw new DOMException("File not found", "NotFoundError");
      return file.handle;
    },
    queryPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => requestedPermission),
  };
  return { handle, files, directories };
}

function fileHandle(
  permission: PermissionState = "granted",
  requestedPermission: PermissionState = permission,
  name = "notes.txt",
  initialContents = "original",
) {
  let contents = initialContents;
  const handle: BrowserFileHandle = {
    name,
    getFile: async () => new File([contents], name, { type: "text/plain" }),
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
  it("persists multi-root workspaces and lists supported files from each granted root", async () => {
    const rootA = directoryHandle("app", {
      "main.ts": "const a = 1",
      "Main.java": "class Main {}",
      ".gitignore": "target",
      "notes.md": "notes",
      image: "binary",
    });
    const rootB = directoryHandle("shared", { "readme.md": "shared", nested: { "inside.rs": "fn main() {}" } });
    const store = new MemoryWorkspaceStore();
    const ids = ["workspace-1", "root-1", "root-2"];
    const deps = runtime({
      workspaces: store,
      createId: () => ids.shift()!,
    });
    const fs = new BrowserFileSystem(deps);

    const workspace = await fs.createWorkspace("Product", [rootA.handle]);
    const updated = await fs.addWorkspaceRoot(workspace.id, rootB.handle);

    expect(updated).toMatchObject({
      name: "Product",
      roots: [
        { id: "root-1", name: "app", permission: "granted" },
        { id: "root-2", name: "shared", permission: "granted" },
      ],
    });
    await expect(new BrowserFileSystem(deps).listWorkspaces()).resolves.toEqual([updated]);
    await expect(fs.listWorkspaceDirectory(workspace.id, "root-1")).resolves.toEqual(
      expect.arrayContaining([
        { name: ".gitignore", path: ".gitignore", kind: "file" },
        { name: "Main.java", path: "Main.java", kind: "file" },
        { name: "main.ts", path: "main.ts", kind: "file" },
        { name: "notes.md", path: "notes.md", kind: "file" },
      ]),
    );
    await expect(fs.listWorkspaceDirectory(workspace.id, "root-2", "nested")).resolves.toEqual([
      { name: "inside.rs", path: "nested/inside.rs", kind: "file" },
    ]);

    const opened = await fs.openWorkspaceFile(workspace.id, "root-2", "nested/inside.rs");
    expect(opened).toMatchObject({ name: "inside.rs", text: "fn main() {}", canWriteToSource: true });
    await expect(fs.save(opened.id, "fn changed() {}")).resolves.toBe("source");
    await expect(fs.openWorkspaceFile(workspace.id, "root-2", "nested/inside.rs")).resolves.toMatchObject({
      id: opened.id,
      text: "fn changed() {}",
    });
    await expect(deps.store.getAll()).resolves.toHaveLength(1);
    await expect(fs.removeWorkspaceRoot(workspace.id, "root-1")).resolves.toMatchObject({
      roots: [{ id: "root-2", name: "shared" }],
    });
    await fs.removeWorkspace(workspace.id);
    await expect(fs.listWorkspaces()).resolves.toEqual([]);
    await expect(fs.read(opened.id)).resolves.toMatchObject({ text: "fn changed() {}" });
  });

  it("rechecks permissions before browsing a restored workspace and reports denial", async () => {
    const denied = directoryHandle("private", { "secret.txt": "content" }, "prompt", "denied");
    const deps = runtime({
      workspaces: new MemoryWorkspaceStore(),
      createId: (() => {
        let next = 0;
        return () => `id-${++next}`;
      })(),
    });
    const fs = new BrowserFileSystem(deps);
    const workspace = await fs.createWorkspace("Private", [denied.handle]);

    await expect(fs.listWorkspaces()).resolves.toMatchObject([{ roots: [{ permission: "prompt" }] }]);
    await expect(fs.listWorkspaceDirectory(workspace.id, "id-2")).rejects.toMatchObject({
      kind: "permissionDenied",
    });
    expect(denied.handle.requestPermission).not.toHaveBeenCalled();
  });

  it("only requests write permission when creating files, not while browsing", async () => {
    const root = directoryHandle("readonly", {});
    root.handle.queryPermission = vi.fn(async ({ mode }) => (mode === "read" ? "granted" : "prompt"));
    root.handle.requestPermission = vi.fn(async ({ mode }) => (mode === "read" ? "granted" : "denied"));
    const deps = runtime({
      workspaces: new MemoryWorkspaceStore(),
      createId: (() => {
        let next = 0;
        return () => `id-${++next}`;
      })(),
    });
    const fs = new BrowserFileSystem(deps);
    const workspace = await fs.createWorkspace("Read only", [root.handle]);

    await expect(fs.listWorkspaceDirectory(workspace.id, "id-2")).resolves.toEqual([]);
    expect(root.handle.requestPermission).not.toHaveBeenCalled();
    await expect(fs.createWorkspaceFile(workspace.id, "id-2", "", "new.md")).rejects.toMatchObject({
      kind: "permissionDenied",
      message: expect.stringContaining("Write access"),
    });
    expect(root.handle.requestPermission).not.toHaveBeenCalled();
  });

  it("reconnects a workspace root and redirects its open documents to the selected folder", async () => {
    const original = directoryHandle("original", { "main.ts": "original contents" });
    const reselected = directoryHandle("reselected", { "main.ts": "reselected contents" });
    const deps = runtime({
      workspaces: new MemoryWorkspaceStore(),
      createId: (() => {
        let next = 0;
        return () => `id-${++next}`;
      })(),
    });
    const fs = new BrowserFileSystem(deps);
    const workspace = await fs.createWorkspace("Reconnect", [original.handle]);
    const document = await fs.openWorkspaceFile(workspace.id, "id-2", "main.ts");

    await expect(fs.replaceWorkspaceRoot(workspace.id, "id-2", reselected.handle)).resolves.toMatchObject({
      roots: [{ id: "id-2", name: "reselected", permission: "granted" }],
    });
    await expect(fs.save(document.id, "edited after reconnect")).resolves.toBe("source");

    expect(original.files.get("main.ts")!.contents()).toBe("original contents");
    expect(reselected.files.get("main.ts")!.contents()).toBe("edited after reconnect");
  });

  it("preserves drafts after write permission is denied and the workspace file is reopened", async () => {
    const root = directoryHandle("app", { "main.ts": "source contents" });
    let writePermission: PermissionState = "granted";
    root.handle.queryPermission = vi.fn(async ({ mode }) => (mode === "read" ? "granted" : writePermission));
    const deps = runtime({
      workspaces: new MemoryWorkspaceStore(),
      createId: (() => {
        let next = 0;
        return () => `id-${++next}`;
      })(),
    });
    const fs = new BrowserFileSystem(deps);
    const workspace = await fs.createWorkspace("App", [root.handle]);
    const opened = await fs.openWorkspaceFile(workspace.id, "id-2", "main.ts");
    writePermission = "denied";

    await expect(fs.save(opened.id, "unsaved draft")).rejects.toMatchObject({
      kind: "permissionDenied",
      message: expect.stringContaining("Reconnect"),
    });
    await expect(fs.openWorkspaceFile(workspace.id, "id-2", "main.ts")).resolves.toMatchObject({
      id: opened.id,
      text: "unsaved draft",
    });
    expect(root.files.get("main.ts")!.contents()).toBe("source contents");
    expect(root.files.get("main.ts")!.handle.requestPermission).not.toHaveBeenCalled();
  });

  it("rejects workspace paths that escape a granted root", async () => {
    const root = directoryHandle("app", { "main.ts": "text" });
    const deps = runtime({
      workspaces: new MemoryWorkspaceStore(),
      createId: (() => {
        let next = 0;
        return () => `id-${++next}`;
      })(),
    });
    const fs = new BrowserFileSystem(deps);
    const workspace = await fs.createWorkspace("App", [root.handle]);

    await expect(fs.listWorkspaceDirectory(workspace.id, "id-2", "../outside")).rejects.toMatchObject({
      kind: "invalidData",
    });
  });

  it("creates supported workspace text files without overwriting existing files", async () => {
    const root = directoryHandle("app", { "existing.ts": "keep this" });
    const deps = runtime({
      workspaces: new MemoryWorkspaceStore(),
      createId: (() => {
        let next = 0;
        return () => `id-${++next}`;
      })(),
    });
    const fs = new BrowserFileSystem(deps);
    const workspace = await fs.createWorkspace("App", [root.handle]);

    const created = await fs.createWorkspaceFile(workspace.id, "id-2", "", "new.ts");

    expect(created).toMatchObject({ name: "new.ts", text: "", canWriteToSource: true });
    await expect(fs.listWorkspaceDirectory(workspace.id, "id-2")).resolves.toContainEqual({
      name: "new.ts",
      path: "new.ts",
      kind: "file",
    });
    await expect(fs.createWorkspaceFile(workspace.id, "id-2", "", "existing.ts")).rejects.toMatchObject({
      kind: "invalidData",
      message: expect.stringContaining("already exists"),
    });
    await expect(fs.createWorkspaceFile(workspace.id, "id-2", "", "../escape.ts")).rejects.toMatchObject({
      kind: "invalidData",
    });
    await expect(fs.openWorkspaceFile(workspace.id, "id-2", "existing.ts")).resolves.toMatchObject({
      text: "keep this",
    });
  });

  it("uses the directory picker when available and reports unsupported folder access otherwise", async () => {
    const root = directoryHandle("app", {});
    const withPicker = new BrowserFileSystem(
      runtime({
        window: { showDirectoryPicker: vi.fn(async () => root.handle) } as unknown as BrowserFileRuntime["window"],
      }),
    );
    await expect(withPicker.pickWorkspaceRoot()).resolves.toBe(root.handle);

    await expect(new BrowserFileSystem(runtime()).pickWorkspaceRoot()).rejects.toMatchObject({
      kind: "unsupported",
      message: expect.stringContaining("individual files"),
    });
  });

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

  it("rejects oversized or invalid UTF-8 files instead of loading corrupted text", async () => {
    const oversized = new File(["x"], "large.txt", { type: "text/plain" });
    Object.defineProperty(oversized, "size", { value: 50 * 1024 * 1024 + 1 });
    const invalid = new File([new Uint8Array([0xff, 0xfe, 0xfd])], "invalid.txt", { type: "text/plain" });
    const selected = (file: File) => {
      const listeners = new Map<string, EventListener>();
      const input = {
        files: [file],
        addEventListener: (type: string, handler: EventListener) => listeners.set(type, handler),
        click: () => listeners.get("change")?.(new Event("change")),
      } as unknown as HTMLInputElement;
      return new BrowserFileSystem(runtime({ document: { createElement: () => input } as unknown as Document }));
    };

    await expect(selected(oversized).openTextFiles()).rejects.toMatchObject({
      kind: "unsupported",
      message: expect.stringContaining("50 MiB limit"),
    });
    await expect(selected(invalid).openTextFiles()).rejects.toMatchObject({
      kind: "invalidData",
      message: expect.stringContaining("valid UTF-8"),
    });
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

  it("downloads a versioned backup of browser documents", async () => {
    const deps = runtime();
    const fs = new BrowserFileSystem(deps);
    await fs.importAll(
      JSON.stringify({
        format: "openidea-browser-files",
        version: 1,
        documents: [{ id: "backup", name: "notes.txt", text: "saved", updatedAt: 123 }],
      }),
    );

    await fs.exportToFile();

    expect(deps.download).toHaveBeenCalledWith(
      "openidea-browser-files.json",
      expect.stringContaining('"text":"saved"'),
    );
  });

  it("exports workspace-opened files as portable content without their source handles", async () => {
    const root = directoryHandle("app", { "main.ts": "const answer = 42;" });
    const deps = runtime({
      workspaces: new MemoryWorkspaceStore(),
      createId: (() => {
        let next = 0;
        return () => `id-${++next}`;
      })(),
    });
    const fs = new BrowserFileSystem(deps);
    const workspace = await fs.createWorkspace("App", [root.handle]);
    await fs.openWorkspaceFile(workspace.id, "id-2", "main.ts");

    const exported = JSON.parse(await fs.exportAll());

    expect(exported).toMatchObject({
      format: "openidea-browser-files",
      documents: [{ name: "main.ts", text: "const answer = 42;" }],
    });
    expect(JSON.stringify(exported)).not.toContain("handle");
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
      await expect(createBrowserFileSystem().listWorkspaces()).resolves.toEqual([]);
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
