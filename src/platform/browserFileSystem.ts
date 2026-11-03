import { grantCapability } from "./capabilities";

/**
 * Browser-managed documents and explicitly granted workspace folders. Handles
 * are capabilities, not paths, and are only used after a permission check.
 */

export type BrowserFileErrorKind = "unsupported" | "permissionDenied" | "notFound" | "invalidData" | "storage";

export class BrowserFileError extends Error {
  constructor(
    readonly kind: BrowserFileErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "BrowserFileError";
  }
}

interface WritableFile {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserFileHandle {
  readonly kind?: "file";
  readonly name: string;
  getFile(): Promise<File>;
  queryPermission(options: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  createWritable(): Promise<WritableFile>;
}

export interface BrowserDirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
  values(): AsyncIterableIterator<BrowserWorkspaceEntryHandle>;
  getDirectoryHandle(name: string): Promise<BrowserDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<BrowserFileHandle>;
  queryPermission(options: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

export type BrowserWorkspaceEntryHandle = BrowserDirectoryHandle | BrowserFileHandle;

interface BrowserFilePickerWindow extends Window {
  showOpenFilePicker?: (options: {
    multiple: boolean;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<BrowserFileHandle[]>;
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<BrowserDirectoryHandle>;
}

export interface BrowserWorkspaceRoot {
  id: string;
  name: string;
  handle: BrowserDirectoryHandle;
}

export interface StoredWorkspace {
  id: string;
  name: string;
  roots: BrowserWorkspaceRoot[];
  updatedAt: number;
}

export interface BrowserWorkspaceSummary {
  id: string;
  name: string;
  roots: Array<{
    id: string;
    name: string;
    permission: PermissionState;
    writePermission: PermissionState;
  }>;
  updatedAt: number;
}

export interface BrowserWorkspaceEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
}

export interface StoredDocument {
  id: string;
  name: string;
  text: string;
  updatedAt: number;
  recent?: boolean;
  handle?: BrowserFileHandle;
  workspaceFile?: { workspaceId: string; rootId: string; relativePath: string };
  sourceText?: string;
}

export interface BrowserTextDocument {
  id: string;
  path: string;
  name: string;
  text: string;
  updatedAt: number;
  canWriteToSource: boolean;
}

export interface BrowserDocumentStore {
  get(id: string): Promise<StoredDocument | undefined>;
  getAll(): Promise<StoredDocument[]>;
  put(document: StoredDocument): Promise<void>;
}

export interface BrowserWorkspaceStore {
  get(id: string): Promise<StoredWorkspace | undefined>;
  getAll(): Promise<StoredWorkspace[]>;
  put(workspace: StoredWorkspace): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface BrowserFileRuntime {
  window?: BrowserFilePickerWindow;
  document?: Document;
  store: BrowserDocumentStore;
  workspaces: BrowserWorkspaceStore;
  now: () => number;
  createId: () => string;
  download: (name: string, text: string) => void;
}

const DATABASE_NAME = "openidea-browser-files";
const DATABASE_VERSION = 2;
const DOCUMENT_STORE = "documents";
const WORKSPACE_STORE = "workspaces";
const EXPORT_VERSION = 1;
const MAX_BROWSER_TEXT_FILE_SIZE = 50 * 1024 * 1024;
const BROWSER_FILE_PREFIX = "browser-file:///";
const TEXT_FILE_EXTENSIONS = [
  ".txt",
  ".md",
  ".csv",
  ".log",
  ".json",
  ".jsonc",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".rs",
  ".py",
  ".java",
  ".kt",
  ".kts",
  ".go",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".cs",
  ".swift",
  ".rb",
  ".php",
  ".sh",
  ".sql",
  ".properties",
  ".ini",
  ".gradle",
  ".vue",
  ".svelte",
  ".scss",
  ".less",
  ".graphql",
  ".proto",
  ".toml",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".css",
];

export function browserFilePath(id: string, name: string): string {
  return `${BROWSER_FILE_PREFIX}${encodeURIComponent(id)}/${encodeURIComponent(name)}`;
}

export function browserFileId(path: string): string | null {
  if (!path.startsWith(BROWSER_FILE_PREFIX)) return null;
  const encodedId = path.slice(BROWSER_FILE_PREFIX.length).split("/", 1)[0];
  if (!encodedId) return null;
  try {
    return decodeURIComponent(encodedId);
  } catch {
    return null;
  }
}

function storageError(error: unknown): BrowserFileError {
  if (error instanceof BrowserFileError) return error;
  if (error && typeof error === "object" && "name" in error && error.name === "QuotaExceededError") {
    return new BrowserFileError("storage", "Browser storage is full. Export your files or free browser storage space.");
  }
  return new BrowserFileError("storage", error instanceof Error ? error.message : String(error));
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) db.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
      if (event.oldVersion < 2) db.createObjectStore(WORKSPACE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (blocked) db.close();
      else resolve(db);
    };
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => {
      blocked = true;
      reject(new BrowserFileError("storage", "Browser storage upgrade is blocked by another tab."));
    };
  });
}

class IndexedDbDocumentStore implements BrowserDocumentStore {
  private database: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory) {}

  private db(): Promise<IDBDatabase> {
    return (this.database ??= openDatabase(this.factory));
  }

  async get(id: string): Promise<StoredDocument | undefined> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DOCUMENT_STORE, "readonly");
      const request = tx.objectStore(DOCUMENT_STORE).get(id);
      request.onsuccess = () => resolve(request.result as StoredDocument | undefined);
      request.onerror = () => reject(storageError(request.error));
      tx.onabort = () => reject(storageError(tx.error));
    });
  }

  async getAll(): Promise<StoredDocument[]> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DOCUMENT_STORE, "readonly");
      const request = tx.objectStore(DOCUMENT_STORE).getAll();
      request.onsuccess = () => resolve(request.result as StoredDocument[]);
      request.onerror = () => reject(storageError(request.error));
      tx.onabort = () => reject(storageError(tx.error));
    });
  }

  async put(document: StoredDocument): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DOCUMENT_STORE, "readwrite");
      tx.objectStore(DOCUMENT_STORE).put(document);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(storageError(tx.error));
      tx.onabort = () => reject(storageError(tx.error));
    }).catch((error: unknown) => {
      throw storageError(error);
    });
  }
}

class IndexedDbWorkspaceStore implements BrowserWorkspaceStore {
  constructor(private readonly database: Promise<IDBDatabase>) {}

  async get(id: string): Promise<StoredWorkspace | undefined> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(WORKSPACE_STORE, "readonly");
      const request = tx.objectStore(WORKSPACE_STORE).get(id);
      request.onsuccess = () => resolve(request.result as StoredWorkspace | undefined);
      request.onerror = () => reject(storageError(request.error));
      tx.onabort = () => reject(storageError(tx.error));
    });
  }

  async getAll(): Promise<StoredWorkspace[]> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(WORKSPACE_STORE, "readonly");
      const request = tx.objectStore(WORKSPACE_STORE).getAll();
      request.onsuccess = () => resolve(request.result as StoredWorkspace[]);
      request.onerror = () => reject(storageError(request.error));
      tx.onabort = () => reject(storageError(tx.error));
    });
  }

  async put(workspace: StoredWorkspace): Promise<void> {
    const db = await this.database;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(WORKSPACE_STORE, "readwrite");
      tx.objectStore(WORKSPACE_STORE).put(workspace);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(storageError(tx.error));
      tx.onabort = () => reject(storageError(tx.error));
    }).catch((error: unknown) => {
      throw storageError(error);
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.database;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(WORKSPACE_STORE, "readwrite");
      tx.objectStore(WORKSPACE_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(storageError(tx.error));
      tx.onabort = () => reject(storageError(tx.error));
    }).catch((error: unknown) => {
      throw storageError(error);
    });
  }
}

class UnavailableDocumentStore implements BrowserDocumentStore {
  private fail(): never {
    throw new BrowserFileError("unsupported", "IndexedDB is unavailable; browser file persistence cannot be used.");
  }
  async get(_id: string): Promise<StoredDocument | undefined> {
    return this.fail();
  }
  async getAll(): Promise<StoredDocument[]> {
    return this.fail();
  }
  async put(_document: StoredDocument): Promise<void> {
    return this.fail();
  }
}

function browserDownload(name: string, text: string, doc: Document, win: Window) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const anchor = doc.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  win.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function defaultRuntime(): BrowserFileRuntime {
  const win = typeof window === "undefined" ? undefined : (window as BrowserFilePickerWindow);
  const doc = typeof document === "undefined" ? undefined : document;
  const database = globalThis.indexedDB ? openDatabase(globalThis.indexedDB) : null;
  return {
    window: win,
    document: doc,
    store: globalThis.indexedDB ? new IndexedDbDocumentStore(globalThis.indexedDB) : new UnavailableDocumentStore(),
    workspaces: database ? new IndexedDbWorkspaceStore(database) : new UnavailableWorkspaceStore(),
    now: Date.now,
    createId: () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    download: (name, text) => {
      if (!doc || !win)
        throw new BrowserFileError("unsupported", "File downloads are unavailable in this environment.");
      browserDownload(name, text, doc, win);
    },
  };
}

class UnavailableWorkspaceStore implements BrowserWorkspaceStore {
  private fail(): never {
    throw new BrowserFileError(
      "unsupported",
      "IndexedDB is unavailable; browser workspace persistence cannot be used.",
    );
  }
  async get(_id: string): Promise<StoredWorkspace | undefined> {
    return this.fail();
  }
  async getAll(): Promise<StoredWorkspace[]> {
    return this.fail();
  }
  async put(_workspace: StoredWorkspace): Promise<void> {
    return this.fail();
  }
  async delete(_id: string): Promise<void> {
    return this.fail();
  }
}

function toDocument(record: StoredDocument): BrowserTextDocument {
  return {
    id: record.id,
    path: browserFilePath(record.id, record.name),
    name: record.name,
    text: record.text,
    updatedAt: record.updatedAt,
    canWriteToSource: !!record.handle,
  };
}

/**
 * File access for the browser vertical slice. Without File System Access API,
 * open uses a user-triggered file input and save downloads the edited text.
 */
export class BrowserFileSystem {
  constructor(private readonly runtime: BrowserFileRuntime = defaultRuntime()) {}

  async pickWorkspaceRoot(mode: "read" | "readwrite" = "readwrite"): Promise<BrowserDirectoryHandle | null> {
    const win = this.runtime.window;
    const picker = win?.showDirectoryPicker;
    if (!picker) {
      throw new BrowserFileError(
        "unsupported",
        "Opening workspace folders requires the File System Access API. You can still open individual files.",
      );
    }
    try {
      return await picker.call(win, { mode });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      throw error;
    }
  }

  async createWorkspace(name: string, roots: readonly BrowserDirectoryHandle[]): Promise<BrowserWorkspaceSummary> {
    if (!roots.length) throw new BrowserFileError("invalidData", "A workspace needs at least one granted folder.");
    const workspace: StoredWorkspace = {
      id: this.runtime.createId(),
      name: name.trim() || roots[0]!.name,
      roots: roots.map((handle) => ({ id: this.runtime.createId(), name: handle.name, handle })),
      updatedAt: this.runtime.now(),
    };
    await this.runtime.workspaces.put(workspace).catch((error: unknown) => {
      throw storageError(error);
    });
    return this.workspaceSummary(workspace);
  }

  async removeWorkspace(workspaceId: string): Promise<void> {
    await this.getWorkspace(workspaceId);
    await this.runtime.workspaces.delete(workspaceId).catch((error: unknown) => {
      throw storageError(error);
    });
  }

  async addWorkspaceRoot(workspaceId: string, root: BrowserDirectoryHandle): Promise<BrowserWorkspaceSummary> {
    const workspace = await this.getWorkspace(workspaceId);
    if (workspace.roots.some((existing) => existing.handle === root)) return this.workspaceSummary(workspace);
    workspace.roots.push({ id: this.runtime.createId(), name: root.name, handle: root });
    workspace.updatedAt = this.runtime.now();
    await this.runtime.workspaces.put(workspace).catch((error: unknown) => {
      throw storageError(error);
    });
    return this.workspaceSummary(workspace);
  }

  async replaceWorkspaceRoot(
    workspaceId: string,
    rootId: string,
    handle: BrowserDirectoryHandle,
  ): Promise<BrowserWorkspaceSummary> {
    const workspace = await this.getWorkspace(workspaceId);
    const index = workspace.roots.findIndex((root) => root.id === rootId);
    if (index < 0) throw new BrowserFileError("notFound", `Workspace folder "${rootId}" was not found.`);
    workspace.roots[index] = { id: rootId, name: handle.name, handle };
    workspace.updatedAt = this.runtime.now();
    await this.runtime.workspaces.put(workspace).catch((error: unknown) => {
      throw storageError(error);
    });
    return this.workspaceSummary(workspace);
  }

  async removeWorkspaceRoot(workspaceId: string, rootId: string): Promise<BrowserWorkspaceSummary> {
    const workspace = await this.getWorkspace(workspaceId);
    workspace.roots = workspace.roots.filter((root) => root.id !== rootId);
    workspace.updatedAt = this.runtime.now();
    await this.runtime.workspaces.put(workspace).catch((error: unknown) => {
      throw storageError(error);
    });
    return this.workspaceSummary(workspace);
  }

  async listWorkspaces(): Promise<BrowserWorkspaceSummary[]> {
    const workspaces = await this.runtime.workspaces.getAll().catch((error: unknown) => {
      throw storageError(error);
    });
    return Promise.all(workspaces.map((workspace) => this.workspaceSummary(workspace)));
  }

  async listWorkspaceDirectory(
    workspaceId: string,
    rootId: string,
    relativePath = "",
  ): Promise<BrowserWorkspaceEntry[]> {
    const { root } = await this.workspaceRoot(workspaceId, rootId);
    await this.ensureWorkspacePermission(root.handle, "read");
    const directory = await this.resolveDirectory(root.handle, relativePath);
    const entries: BrowserWorkspaceEntry[] = [];
    for await (const entry of directory.values()) {
      if (entry.kind === "directory") {
        entries.push({ name: entry.name, path: joinRelative(relativePath, entry.name), kind: "directory" });
      } else if (isTextFile(entry.name)) {
        entries.push({ name: entry.name, path: joinRelative(relativePath, entry.name), kind: "file" });
      }
    }
    return entries.sort(
      (a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name),
    );
  }

  async openWorkspaceFile(workspaceId: string, rootId: string, relativePath: string): Promise<BrowserTextDocument> {
    const { workspace, root } = await this.workspaceRoot(workspaceId, rootId);
    await this.ensureWorkspacePermission(root.handle, "read");
    const parts = pathParts(relativePath);
    const name = parts.pop();
    if (!name || !isTextFile(name)) {
      throw new BrowserFileError("unsupported", "Only supported text files can be opened from browser workspaces.");
    }
    let directory = root.handle;
    for (const part of parts) directory = await directory.getDirectoryHandle(part);
    const handle = await directory.getFileHandle(name);
    const file = await handle.getFile();
    const storedDocuments = await this.runtime.store.getAll().catch((error: unknown) => {
      throw storageError(error);
    });
    const existing = storedDocuments.find(
      (document) =>
        document.workspaceFile?.workspaceId === workspace.id &&
        document.workspaceFile.rootId === root.id &&
        document.workspaceFile.relativePath === relativePath,
    );
    const diskText = await decodeTextFile(file);
    const hasPendingEdits = existing?.sourceText !== undefined && existing.text !== existing.sourceText;
    const record: StoredDocument = {
      id: existing?.id ?? this.runtime.createId(),
      name,
      text: hasPendingEdits ? existing.text : diskText,
      updatedAt: this.runtime.now(),
      recent: true,
      handle,
      workspaceFile: { workspaceId: workspace.id, rootId: root.id, relativePath },
      sourceText: hasPendingEdits ? existing.sourceText : diskText,
    };
    await this.runtime.store.put(record).catch((error: unknown) => {
      throw storageError(error);
    });
    return toDocument(record);
  }

  async createWorkspaceFile(
    workspaceId: string,
    rootId: string,
    relativePath: string,
    name: string,
  ): Promise<BrowserTextDocument> {
    const { workspace, root } = await this.workspaceRoot(workspaceId, rootId);
    await this.ensureWorkspacePermission(root.handle, "readwrite");
    const safeName = name.trim();
    if (
      !safeName ||
      safeName === "." ||
      safeName === ".." ||
      safeName.includes("/") ||
      safeName.includes("\\") ||
      !isTextFile(safeName)
    ) {
      throw new BrowserFileError("invalidData", "Enter a file name with a supported text-file extension.");
    }

    const directory = await this.resolveDirectory(root.handle, relativePath);
    try {
      await directory.getFileHandle(safeName);
      throw new BrowserFileError("invalidData", `A file named "${safeName}" already exists.`);
    } catch (error) {
      if (error instanceof BrowserFileError) throw error;
      if (!(error && typeof error === "object" && "name" in error && error.name === "NotFoundError")) throw error;
    }
    const handle = await directory.getFileHandle(safeName, { create: true });
    const writable = await handle.createWritable();
    await writable.write("");
    await writable.close();
    const filePath = joinRelative(relativePath, safeName);
    const record: StoredDocument = {
      id: this.runtime.createId(),
      name: safeName,
      text: "",
      updatedAt: this.runtime.now(),
      recent: true,
      handle,
      workspaceFile: { workspaceId: workspace.id, rootId: root.id, relativePath: filePath },
      sourceText: "",
    };
    await this.runtime.store.put(record).catch((error: unknown) => {
      throw storageError(error);
    });
    return toDocument(record);
  }

  async openTextFiles(multiple = true): Promise<BrowserTextDocument[]> {
    const { window: win, document: doc } = this.runtime;
    if (win?.showOpenFilePicker) {
      let handles: BrowserFileHandle[];
      try {
        handles = await win.showOpenFilePicker({
          multiple,
          types: [{ description: "Text files", accept: { "text/*": TEXT_FILE_EXTENSIONS } }],
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return [];
        throw error;
      }
      const documents = await Promise.all(handles.map((handle) => this.readHandle(handle)));
      if (documents.length) grantCapability("filesystem");
      return documents;
    }

    if (!doc) throw new BrowserFileError("unsupported", "File selection is unavailable in this environment.");
    const files = await this.selectFiles(doc, multiple);
    const documents = await Promise.all(files.map(async (file) => this.storeFile(file)));
    if (documents.length) grantCapability("filesystem");
    return documents;
  }

  async read(id: string): Promise<BrowserTextDocument> {
    const record = await this.runtime.store.get(id).catch((error: unknown) => {
      throw storageError(error);
    });
    if (!record) throw new BrowserFileError("notFound", `Browser document "${id}" was not found.`);
    return toDocument(record);
  }

  async list(): Promise<BrowserTextDocument[]> {
    const records = await this.runtime.store.getAll().catch((error: unknown) => {
      throw storageError(error);
    });
    return records
      .filter((record) => record.recent !== false)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toDocument);
  }

  async remove(id: string): Promise<void> {
    const record = await this.runtime.store.get(id).catch((error: unknown) => {
      throw storageError(error);
    });
    if (!record) throw new BrowserFileError("notFound", `Browser document "${id}" was not found.`);
    await this.runtime.store.put({ ...record, recent: false }).catch((error: unknown) => {
      throw storageError(error);
    });
  }

  async save(id: string, text: string): Promise<"source" | "download"> {
    const record = await this.runtime.store.get(id).catch((error: unknown) => {
      throw storageError(error);
    });
    if (!record) throw new BrowserFileError("notFound", `Browser document "${id}" was not found.`);

    const updated = { ...record, text, updatedAt: this.runtime.now(), recent: true };
    await this.runtime.store.put(updated).catch((error: unknown) => {
      throw storageError(error);
    });

    let handle = record.handle;
    if (record.workspaceFile) {
      const { root } = await this.workspaceRoot(record.workspaceFile.workspaceId, record.workspaceFile.rootId);
      await this.ensureWorkspacePermission(root.handle, "readwrite");
      const parts = pathParts(record.workspaceFile.relativePath);
      const name = parts.pop();
      if (!name) throw new BrowserFileError("invalidData", "Workspace document has an invalid relative path.");
      const directory = await this.resolveDirectory(root.handle, parts.join("/"));
      handle = await directory.getFileHandle(name);
      await this.runtime.store.put({ ...updated, handle }).catch((error: unknown) => {
        throw storageError(error);
      });
    }

    if (!handle) {
      this.runtime.download(record.name, text);
      return "download";
    }

    let permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted" && !record.workspaceFile) {
      permission = await handle.requestPermission({ mode: "readwrite" });
    }
    if (permission !== "granted") {
      throw new BrowserFileError(
        "permissionDenied",
        `Write permission for "${record.name}" was denied. Your edits remain in browser storage.`,
      );
    }

    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    if (record.workspaceFile) {
      await this.runtime.store.put({ ...updated, handle, sourceText: text }).catch((error: unknown) => {
        throw storageError(error);
      });
    }
    return "source";
  }

  async exportAll(): Promise<string> {
    const documents = await this.runtime.store.getAll().catch((error: unknown) => {
      throw storageError(error);
    });
    return JSON.stringify({
      format: "openidea-browser-files",
      version: EXPORT_VERSION,
      documents: documents.map(({ id, name, text, updatedAt }) => ({ id, name, text, updatedAt })),
    });
  }

  async exportToFile(): Promise<void> {
    const data = await this.exportAll();
    this.runtime.download("openidea-browser-files.json", data);
  }

  async importAll(json: string): Promise<number> {
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      throw new BrowserFileError("invalidData", "The browser file export is not valid JSON.");
    }
    if (!data || typeof data !== "object" || !("format" in data) || !("version" in data) || !("documents" in data)) {
      throw new BrowserFileError("invalidData", "The browser file export has an invalid structure.");
    }
    const payload = data as { format: unknown; version: unknown; documents: unknown };
    if (
      payload.format !== "openidea-browser-files" ||
      payload.version !== EXPORT_VERSION ||
      !Array.isArray(payload.documents) ||
      !payload.documents.every(isExportedDocument)
    ) {
      throw new BrowserFileError("invalidData", "The browser file export uses an unsupported format or version.");
    }

    for (const document of payload.documents) {
      const imported: StoredDocument = {
        id: document.id,
        name: document.name,
        text: document.text,
        updatedAt: document.updatedAt,
        recent: true,
      };
      await this.runtime.store.put(imported).catch((error: unknown) => {
        throw storageError(error);
      });
    }
    return payload.documents.length;
  }

  private async readHandle(handle: BrowserFileHandle): Promise<BrowserTextDocument> {
    const file = await handle.getFile();
    return this.persist(handle.name, await decodeTextFile(file), handle);
  }

  private async storeFile(file: File): Promise<BrowserTextDocument> {
    return this.persist(file.name, await decodeTextFile(file));
  }

  private async persist(name: string, text: string, handle?: BrowserFileHandle): Promise<BrowserTextDocument> {
    const record: StoredDocument = {
      id: this.runtime.createId(),
      name,
      text,
      updatedAt: this.runtime.now(),
      recent: true,
      handle,
    };
    await this.runtime.store.put(record).catch((error: unknown) => {
      throw storageError(error);
    });
    return toDocument(record);
  }

  private async getWorkspace(id: string): Promise<StoredWorkspace> {
    const workspace = await this.runtime.workspaces.get(id).catch((error: unknown) => {
      throw storageError(error);
    });
    if (!workspace) throw new BrowserFileError("notFound", `Browser workspace "${id}" was not found.`);
    return workspace;
  }

  private async workspaceRoot(
    workspaceId: string,
    rootId: string,
  ): Promise<{ workspace: StoredWorkspace; root: BrowserWorkspaceRoot }> {
    const workspace = await this.getWorkspace(workspaceId);
    const root = workspace.roots.find((item) => item.id === rootId);
    if (!root) throw new BrowserFileError("notFound", `Workspace folder "${rootId}" was not found.`);
    return { workspace, root };
  }

  private async workspaceSummary(workspace: StoredWorkspace): Promise<BrowserWorkspaceSummary> {
    const roots = await Promise.all(
      workspace.roots.map(async ({ id, name, handle }) => ({
        id,
        name,
        permission: await handle.queryPermission({ mode: "read" }),
        writePermission: await handle.queryPermission({ mode: "readwrite" }),
      })),
    );
    return { id: workspace.id, name: workspace.name, roots, updatedAt: workspace.updatedAt };
  }

  private async ensureWorkspacePermission(handle: BrowserDirectoryHandle, mode: "read" | "readwrite"): Promise<void> {
    const permission = await handle.queryPermission({ mode });
    if (permission !== "granted") {
      throw new BrowserFileError(
        "permissionDenied",
        `${mode === "read" ? "Read" : "Write"} access to workspace folder "${handle.name}" is not granted. Use Reconnect to select the folder and grant access.`,
      );
    }
  }

  private async resolveDirectory(root: BrowserDirectoryHandle, relativePath: string): Promise<BrowserDirectoryHandle> {
    let directory = root;
    for (const part of pathParts(relativePath)) directory = await directory.getDirectoryHandle(part);
    return directory;
  }

  private selectFiles(doc: Document, multiple: boolean): Promise<File[]> {
    return new Promise((resolve, reject) => {
      const input = doc.createElement("input");
      input.type = "file";
      input.multiple = multiple;
      input.accept = `text/*,${TEXT_FILE_EXTENSIONS.join(",")}`;
      input.addEventListener("change", () => resolve(Array.from(input.files ?? [])), { once: true });
      input.addEventListener("cancel", () => resolve([]), { once: true });
      input.addEventListener(
        "error",
        () => reject(new BrowserFileError("unsupported", "Could not read the selected files.")),
        {
          once: true,
        },
      );
      input.click();
    });
  }
}

function pathParts(path: string): string[] {
  if (path.startsWith("/") || path.includes("\\")) {
    throw new BrowserFileError("invalidData", "Workspace paths must be relative paths inside a granted folder.");
  }
  const parts = path.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new BrowserFileError("invalidData", "Workspace paths must be relative paths inside a granted folder.");
  }
  return parts;
}

function joinRelative(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child;
}

function isTextFile(name: string): boolean {
  const lowerName = name.toLowerCase();
  return (
    [".gitignore", ".gitattributes", ".editorconfig", ".env", "makefile", "dockerfile"].includes(lowerName) ||
    TEXT_FILE_EXTENSIONS.some((extension) => lowerName.endsWith(extension))
  );
}

async function decodeTextFile(file: File): Promise<string> {
  if (file.size > MAX_BROWSER_TEXT_FILE_SIZE) {
    throw new BrowserFileError(
      "unsupported",
      `"${file.name}" is too large to edit in the browser (50 MiB limit). Open it in the desktop app instead.`,
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
  } catch (error) {
    if (error instanceof TypeError) {
      throw new BrowserFileError(
        "invalidData",
        `"${file.name}" is not valid UTF-8; browser editing supports UTF-8 text files.`,
      );
    }
    throw error;
  }
}

function isExportedDocument(value: unknown): value is StoredDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<StoredDocument>;
  return (
    typeof document.id === "string" &&
    typeof document.name === "string" &&
    typeof document.text === "string" &&
    typeof document.updatedAt === "number"
  );
}

/** Creates an adapter with the real IndexedDB-backed browser storage. */
export function createBrowserFileSystem(): BrowserFileSystem {
  return new BrowserFileSystem();
}
