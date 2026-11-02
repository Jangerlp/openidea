# Browser file access

The browser file adapter is an asynchronous TypeScript boundary; the Rust
`ide-vfs::FileSystem` contract remains for synchronous native operations and is
not called from browser code.

`BrowserFileSystem` supports a deliberately small text-file flow:

- File › Open File… crosses the platform dialog adapter, uses the browser
  picker and opens selected files in the editor's browser LightEdit mode.
- `openTextFiles()` asks the user to select files. Browsers with the File
  System Access API retain the selected handles; other browsers use a standard
  multi-file input and keep an imported copy.
- Reads and edits are stored in IndexedDB (`openidea-browser-files`, schema
  version 1). The upgrade handler creates the document store; future schema
  changes must increment the database version and migrate in `onupgradeneeded`.
- `save()` first persists the edited text in IndexedDB. A retained file handle
  is written only after a read/write permission check and explicit request.
  Without a handle, edits are exported as a browser download. A denied or
  revoked permission is an error; the browser copy remains available.
- `exportAll()` creates a versioned JSON backup without filesystem handles.
  `importAll()` validates that format and restores its text documents.
- Storage quota, blocked upgrades, malformed imports, and missing browser APIs
  are surfaced as errors; the adapter does not report unsupported operations
  as successful.

The fallback cannot overwrite the user's original file or restore a file
handle after reload. The user must download the changed copy and choose it
again to resume direct access. This adapter does not provide arbitrary paths,
directory traversal, watching, trash, or native filesystem permissions.
