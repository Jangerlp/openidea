import { grantCapability } from "./capabilities";

/**
 * Browser-managed files selected by the user. Handles are capabilities, not
 * paths, and are only used after an explicit permission check.
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
  readonly name: string;
  getFile(): Promise<File>;
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  createWritable(): Promise<WritableFile>;
}

interface BrowserFilePickerWindow extends Window {
  showOpenFilePicker?: (options: {
    multiple: boolean;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<BrowserFileHandle[]>;
}

export interface StoredDocument {
  id: string;
  name: string;
  text: string;
  updatedAt: number;
  recent?: boolean;
  handle?: BrowserFileHandle;
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

export interface BrowserFileRuntime {
  window?: BrowserFilePickerWindow;
  document?: Document;
  store: BrowserDocumentStore;
  now: () => number;
  createId: () => string;
  download: (name: string, text: string) => void;
}

const DATABASE_NAME = "openidea-browser-files";
const DATABASE_VERSION = 1;
const DOCUMENT_STORE = "documents";
const EXPORT_VERSION = 1;
const BROWSER_FILE_PREFIX = "browser-file:///";
const TEXT_FILE_EXTENSIONS = [
  ".txt",
  ".md",
  ".csv",
  ".log",
  ".json",
  ".ts",
  ".tsx",
  ".js",
  ".rs",
  ".py",
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
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) db.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () =>
      reject(new BrowserFileError("storage", "Browser storage upgrade is blocked by another tab."));
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
  return {
    window: win,
    document: doc,
    store: globalThis.indexedDB ? new IndexedDbDocumentStore(globalThis.indexedDB) : new UnavailableDocumentStore(),
    now: Date.now,
    createId: () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    download: (name, text) => {
      if (!doc || !win)
        throw new BrowserFileError("unsupported", "File downloads are unavailable in this environment.");
      browserDownload(name, text, doc, win);
    },
  };
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

    if (!record.handle) {
      this.runtime.download(record.name, text);
      return "download";
    }

    let permission = await record.handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") permission = await record.handle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      throw new BrowserFileError(
        "permissionDenied",
        `Write permission for "${record.name}" was denied. Your edits remain in browser storage.`,
      );
    }

    const writable = await record.handle.createWritable();
    await writable.write(text);
    await writable.close();
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
    return this.persist(handle.name, await file.text(), handle);
  }

  private async storeFile(file: File): Promise<BrowserTextDocument> {
    return this.persist(file.name, await file.text());
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
