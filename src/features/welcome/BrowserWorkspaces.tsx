import { useEffect, useMemo, useRef, useState } from "react";
import {
  createBrowserFileSystem,
  type BrowserDirectoryHandle,
  type BrowserWorkspaceEntry,
  type BrowserWorkspaceSummary,
} from "@/platform/browserFileSystem";
import { useProject } from "@/platform/project";
import { loadRecent } from "./recent";
import { editorService } from "@/workbench/contributions";
import { Button, Dialog, Icon, IconButton, Input, T } from "@/ui";
import styles from "./BrowserWorkspaces.module.css";

interface BrowserLocation {
  workspaceId: string;
  rootId: string;
  path: string;
  entries: BrowserWorkspaceEntry[];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function BrowserWorkspaces() {
  const fileSystem = useMemo(() => createBrowserFileSystem(), []);
  const [workspaces, setWorkspaces] = useState<BrowserWorkspaceSummary[]>([]);
  const [location, setLocation] = useState<BrowserLocation | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingFile, setCreatingFile] = useState(false);
  const [name, setName] = useState("");
  const [fileName, setFileName] = useState("");
  const [roots, setRoots] = useState<BrowserDirectoryHandle[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      setWorkspaces(await fileSystem.listWorkspaces());
    } catch (reason) {
      setError(message(reason));
    }
  };

  useEffect(() => {
    let active = true;
    void fileSystem
      .listWorkspaces()
      .then((items) => {
        if (active) setWorkspaces(items);
      })
      .catch((reason: unknown) => {
        if (active) setError(message(reason));
      });
    return () => {
      active = false;
    };
  }, [fileSystem]);

  const browse = async (workspaceId: string, rootId: string, path: string) => {
    setBusy(true);
    setError("");
    try {
      const entries = await fileSystem.listWorkspaceDirectory(workspaceId, rootId, path);
      setLocation({ workspaceId, rootId, path, entries });
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };

  const addFolder = async () => {
    setError("");
    try {
      const root = await fileSystem.pickWorkspaceRoot();
      if (root) setRoots((current) => (current.some((item) => item === root) ? current : [...current, root]));
    } catch (reason) {
      setError(message(reason));
    }
  };

  const create = async () => {
    if (busy || !roots.length) return;
    setBusy(true);
    setError("");
    try {
      const workspace = await fileSystem.createWorkspace(name, roots);
      setCreating(false);
      setName("");
      setRoots([]);
      await refresh();
      const firstRoot = workspace.roots[0];
      if (firstRoot) await browse(workspace.id, firstRoot.id, "");
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };

  const addRoot = async (workspaceId: string) => {
    setError("");
    try {
      const root = await fileSystem.pickWorkspaceRoot();
      if (!root) return;
      const updated = await fileSystem.addWorkspaceRoot(workspaceId, root);
      setWorkspaces((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (reason) {
      setError(message(reason));
    }
  };

  const reconnectRoot = async (workspaceId: string, rootId: string) => {
    setError("");
    try {
      const handle = await fileSystem.pickWorkspaceRoot("readwrite");
      if (!handle) return;
      const updated = await fileSystem.replaceWorkspaceRoot(workspaceId, rootId, handle);
      setWorkspaces((current) => current.map((workspace) => (workspace.id === updated.id ? updated : workspace)));
      if (location?.workspaceId === workspaceId && location.rootId === rootId) {
        const entries = await fileSystem.listWorkspaceDirectory(workspaceId, rootId, location.path);
        setLocation({ ...location, entries });
      }
    } catch (reason) {
      setError(message(reason));
    }
  };

  const removeRoot = async (workspaceId: string, rootId: string) => {
    setError("");
    try {
      const updated = await fileSystem.removeWorkspaceRoot(workspaceId, rootId);
      setWorkspaces((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      if (location?.workspaceId === workspaceId && location.rootId === rootId) setLocation(null);
    } catch (reason) {
      setError(message(reason));
    }
  };

  const removeWorkspace = async (workspaceId: string) => {
    setError("");
    try {
      await fileSystem.removeWorkspace(workspaceId);
      setWorkspaces((current) => current.filter((workspace) => workspace.id !== workspaceId));
      if (location?.workspaceId === workspaceId) setLocation(null);
    } catch (reason) {
      setError(message(reason));
    }
  };

  const openFile = async (entry: BrowserWorkspaceEntry) => {
    if (!location || entry.kind !== "file") return;
    setBusy(true);
    setError("");
    try {
      const document = await fileSystem.openWorkspaceFile(location.workspaceId, location.rootId, entry.path);
      if (!useProject.getState().project) useProject.setState({ lightEdit: true });
      await editorService().openFile(document.path, { focus: true, preview: false });
      await loadRecent();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };

  const createFile = async () => {
    if (!location || busy) return;
    setBusy(true);
    setError("");
    try {
      const document = await fileSystem.createWorkspaceFile(
        location.workspaceId,
        location.rootId,
        location.path,
        fileName,
      );
      setCreatingFile(false);
      setFileName("");
      const entries = await fileSystem.listWorkspaceDirectory(location.workspaceId, location.rootId, location.path);
      setLocation({ ...location, entries });
      if (!useProject.getState().project) useProject.setState({ lightEdit: true });
      await editorService().openFile(document.path, { focus: true, preview: false });
      await loadRecent();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };

  const exportFiles = async () => {
    setError("");
    try {
      await fileSystem.exportToFile();
    } catch (reason) {
      setError(message(reason));
    }
  };

  const importFiles = async (file?: File) => {
    if (!file) return;
    setError("");
    try {
      const count = await fileSystem.importAll(await file.text());
      await loadRecent();
      setWorkspaces(await fileSystem.listWorkspaces());
      if (count) setLocation(null);
    } catch (reason) {
      setError(message(reason));
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  };

  const activeWorkspace = workspaces.find((workspace) => workspace.id === location?.workspaceId);
  const activeRoot = activeWorkspace?.roots.find((root) => root.id === location?.rootId);

  return (
    <section className={styles.section} aria-label="Browser workspaces">
      <div className={styles.heading}>
        <h2>
          <T>Browser workspaces</T>
        </h2>
        <Button
          size="small"
          icon="plus"
          onClick={() => {
            setName("");
            setRoots([]);
            setError("");
            setCreating(true);
          }}
        >
          <T>New Workspace</T>
        </Button>
      </div>
      <div className={styles.portability}>
        <Button size="small" onClick={() => void exportFiles()}>
          <T>Export saved browser files</T>
        </Button>
        <Button size="small" onClick={() => importInput.current?.click()}>
          <T>Import browser file backup</T>
        </Button>
        <input
          ref={importInput}
          type="file"
          accept=".json,application/json"
          aria-label="Import browser file backup"
          hidden
          onChange={(event) => void importFiles(event.currentTarget.files?.[0])}
        />
      </div>
      {location && activeWorkspace && activeRoot ? (
        <div className={styles.browser}>
          <div className={styles.heading}>
            <Button size="small" icon="arrow-left" disabled={busy} onClick={() => setLocation(null)}>
              <T>Workspaces</T>
            </Button>
            <strong>{activeWorkspace.name}</strong>
            <Button
              size="small"
              icon="plus"
              disabled={busy}
              onClick={() => {
                setFileName("");
                setError("");
                setCreatingFile(true);
              }}
            >
              <T>New File</T>
            </Button>
            <select
              aria-label="Workspace folder"
              value={location.rootId}
              disabled={busy}
              onChange={(event) => void browse(location.workspaceId, event.target.value, "")}
            >
              {activeWorkspace.roots.map((root) => (
                <option key={root.id} value={root.id}>
                  {root.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.path} title={location.path || activeRoot.name}>
            {activeRoot.name}
            {location.path ? ` / ${location.path}` : ""}
          </div>
          {location.path && (
            <Button
              size="small"
              disabled={busy}
              onClick={() => {
                const parent = location.path.split("/").slice(0, -1).join("/");
                void browse(location.workspaceId, location.rootId, parent);
              }}
            >
              <T>Up</T>
            </Button>
          )}
          <div className={styles.entries} role="list" aria-label="Workspace files">
            {location.entries.map((entry) => (
              <button
                type="button"
                key={`${entry.kind}:${entry.path}`}
                className={styles.entry}
                disabled={busy}
                onClick={() =>
                  entry.kind === "directory"
                    ? void browse(location.workspaceId, location.rootId, entry.path)
                    : void openFile(entry)
                }
              >
                <Icon name={entry.kind === "directory" ? "folder" : "file"} size={16} />
                <span>{entry.name}</span>
              </button>
            ))}
            {!location.entries.length && (
              <p className={styles.hint}>
                <T>No supported text files in this folder.</T>
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.list}>
          {workspaces.map((workspace) => (
            <article key={workspace.id} className={styles.workspace}>
              <div className={styles.workspaceTitle}>
                <Icon name="folder" size={18} />
                <strong>{workspace.name}</strong>
                <span>
                  {workspace.roots.length} <T>folders</T>
                </span>
                <Button
                  size="small"
                  disabled={busy || !workspace.roots.length}
                  onClick={() => {
                    const root = workspace.roots[0];
                    if (root) void browse(workspace.id, root.id, "");
                  }}
                >
                  <T>Open</T>
                </Button>
                <IconButton
                  icon="close"
                  title={`Remove workspace ${workspace.name}`}
                  disabled={busy}
                  onClick={() => void removeWorkspace(workspace.id)}
                />
              </div>
              <div className={styles.roots}>
                {workspace.roots.map((root) => (
                  <div key={root.id} className={styles.root}>
                    <span>{root.name}</span>
                    <span
                      className={root.permission === "granted" ? styles.permissionGranted : styles.permissionNeeded}
                    >
                      {root.permission === "granted" ? <T>Read access granted</T> : <T>Read access required</T>}
                    </span>
                    <span
                      className={
                        root.writePermission === "granted" ? styles.permissionGranted : styles.permissionNeeded
                      }
                    >
                      {root.writePermission === "granted" ? <T>Write access granted</T> : <T>Write access required</T>}
                    </span>
                    <Button size="small" disabled={busy} onClick={() => void reconnectRoot(workspace.id, root.id)}>
                      <T>
                        {root.permission === "granted" && root.writePermission === "granted"
                          ? "Change folder"
                          : "Reconnect"}
                      </T>
                    </Button>
                    <IconButton
                      icon="close"
                      title={`Remove ${root.name}`}
                      disabled={busy}
                      onClick={() => void removeRoot(workspace.id, root.id)}
                    />
                  </div>
                ))}
                <Button size="small" icon="plus" disabled={busy} onClick={() => void addRoot(workspace.id)}>
                  <T>Add folder</T>
                </Button>
              </div>
            </article>
          ))}
          {!workspaces.length && (
            <p className={styles.hint}>
              <T>No browser workspaces yet.</T>
            </p>
          )}
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {creating && (
        <Dialog
          open
          onClose={() => {
            if (!busy) setCreating(false);
          }}
          title="New Browser Workspace"
          width={520}
          buttons={[
            { label: "Cancel", role: "cancel", disabled: busy },
            { label: "Create", role: "default", disabled: busy || !roots.length, onClick: () => void create() },
          ]}
        >
          <div className={styles.createForm}>
            <label>
              <T>Name</T>
              <Input
                aria-label="Workspace name"
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className={styles.roots}>
              {roots.map((root, index) => (
                <div key={`${root.name}:${index}`} className={styles.root}>
                  {root.name}
                </div>
              ))}
              <Button size="small" icon="plus" disabled={busy} onClick={() => void addFolder()}>
                <T>Add folder</T>
              </Button>
            </div>
            <p className={styles.hint}>
              <T>
                Each folder is shared explicitly. Removing a workspace does not delete its folders or saved files.
                Backups contain saved file contents, not workspace handles or access grants. Browser workspaces support
                text-file browsing and editing; native project tools remain unavailable.
              </T>
            </p>
            {error && (
              <div className={styles.error} role="alert">
                {error}
              </div>
            )}
          </div>
        </Dialog>
      )}
      {creatingFile && (
        <Dialog
          open
          onClose={() => {
            if (!busy) setCreatingFile(false);
          }}
          title="New Workspace File"
          width={460}
          buttons={[
            { label: "Cancel", role: "cancel", disabled: busy },
            { label: "Create", role: "default", disabled: busy || !fileName.trim(), onClick: () => void createFile() },
          ]}
        >
          <div className={styles.createForm}>
            <label>
              <T>File name</T>
              <Input
                aria-label="Workspace file name"
                placeholder="notes.md"
                value={fileName}
                disabled={busy}
                onChange={(event) => setFileName(event.target.value)}
              />
            </label>
            <p className={styles.hint}>
              <T>A new empty text file is created in the current folder. Existing files are never overwritten.</T>
            </p>
            {error && (
              <div className={styles.error} role="alert">
                {error}
              </div>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}
