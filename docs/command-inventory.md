# Command Inventory & Classification

Inventory of the 41 IPC command domains from `src-tauri/src/commands/mod.rs` and `src/bindings.ts`, classified according to their browser migration strategy.

## Classification Categories

1. **Browser/WASM (Deterministic Computation):** No OS or network access required. Candidates for Rust compiled to `wasm32-unknown-unknown` or TypeScript implementation.
2. **Browser API:** Replaces native host APIs with standard Web APIs (IndexedDB, Storage, Clipboard API, File System Access API, MatchMedia, Window/DOM).
3. **Unavailable in Browser:** Requires native OS privileges (PTY, process spawning, arbitrary raw TCP/UDP, low-level debug tracing) with no direct browser equivalent. Reports explicit `unavailable` state.
4. **Service-Dependent:** Can only function via an optional, separately deployed remote service / daemon (e.g. Remote Development over SSH/WebSocket).

---

## Domain Inventory

| Domain           | File                       | Primary Operations                         | Target Classification      | Notes / Browser Strategy                                      |
| ---------------- | -------------------------- | ------------------------------------------ | -------------------------- | ------------------------------------------------------------- |
| **agent**        | `commands/agent.rs`        | AI agent workflows, streaming completions  | **Service-Dependent**      | Remote LLM endpoint or WebLLM/WASM engine                     |
| **analysis**     | `commands/analysis.rs`     | Code inspections, AST queries              | **Browser/WASM**           | Tree-sitter / pure analysis in WASM                           |
| **app**          | `commands/app.rs`          | App metadata, version, locale              | **Browser API**            | Static package info + browser locale                          |
| **build**        | `commands/build.rs`        | Build execution, toolchain invocation      | **Unavailable**            | Spawning native compilers requires native host                |
| **bytes**        | `commands/bytes.rs`        | File probe, byte-range and image reads     | **Browser API / VFS**      | Selected browser files; current commands require native paths |
| **caches**       | `commands/caches.rs`       | Cache invalidation, disk cache stats       | **Browser API**            | CacheStorage / OPFS / IndexedDB                               |
| **clipboard**    | `commands/clipboard.rs`    | Read/write clipboard (text, files)         | **Browser API**            | `navigator.clipboard`                                         |
| **coverage**     | `commands/coverage.rs`     | Test coverage runner & report viewer       | **Unavailable**            | Test runners require native execution                         |
| **db**           | `commands/db.rs`           | Database drivers (Postgres, MySQL, SQLite) | **Unavailable**            | Native TCP drivers; SQLite can use sql.js/WASM                |
| **debug**        | `commands/debug.rs`        | Debug Adapter Protocol (DAP) sessions      | **Service-Dependent**      | Native DAP servers require socket/stdio                       |
| **dependencies** | `commands/dependencies.rs` | Package manager resolution (npm, Cargo)    | **Unavailable**            | File/process based dependency resolution                      |
| **deploy**       | `commands/deploy.rs`       | Remote deployment & SSH upload             | **Service-Dependent**      | Requires network transport                                    |
| **doc**          | `commands/doc.rs`          | Document open, line offsets, formatting    | **Browser/WASM**           | Pure text/document buffer handling                            |
| **docker**       | `commands/docker.rs`       | Container discovery, logs, execution       | **Unavailable**            | Docker daemon socket not accessible from browser              |
| **env**          | `commands/env.rs`          | Environment variable inspection            | **Browser API**            | Browser environment stub / simulated env                      |
| **fonts**        | `commands/fonts.rs`        | System font enumeration, user font data    | **Browser API**            | `queryLocalFonts()` (where supported) or bundled              |
| **fs**           | `commands/fs.rs`           | File read, write, list, watch, stats       | **Browser API / VFS**      | File System Access API & in-memory/OPFS VFS (PR 5-6)          |
| **github**       | `commands/github.rs`       | GitHub API, PRs, issues                    | **Browser API / Service**  | Fetch with CORS / Personal Access Token                       |
| **history**      | `commands/history.rs`      | Local file history & undo stack            | **Browser API**            | IndexedDB persistence                                         |
| **http**         | `commands/http.rs`         | HTTP scratchpad / client requests          | **Browser API**            | `fetch()` subject to CORS, or proxy                           |
| **java**         | `commands/java.rs`         | JDK discovery, decompilation, classpath    | **Unavailable / Service**  | Requires local JVM / jdtls                                    |
| **lsp**          | `commands/lsp.rs`          | Language Server Protocol integration       | **Service-Dependent**      | WebWorker LSP (JSON/TS) or remote LSP server                  |
| **nav**          | `commands/nav.rs`          | Symbol navigation, go to definition        | **Browser/WASM**           | Index lookup in memory / WASM                                 |
| **notebook**     | `commands/notebook.rs`     | Interactive notebooks & cell outputs       | **Browser API**            | Pure renderer / browser JS kernel                             |
| **perf**         | `commands/perf.rs`         | Performance benchmarks & probe stats       | **Browser/WASM**           | Browser performance API                                       |
| **plugin**       | `commands/plugin.rs`       | Plugin installation & management           | **Browser API**            | Web plugin bundles / ES modules                               |
| **profiler**     | `commands/profiler.rs`     | CPU/memory profiling                       | **Unavailable**            | Requires native OS tracing / perf counters                    |
| **refactor**     | `commands/refactor.rs`     | Rename, extract variable, safe delete      | **Browser/WASM**           | AST refactoring in WASM                                       |
| **run**          | `commands/run.rs`          | Process execution, run configurations      | **Unavailable**            | Browser cannot spawn local processes                          |
| **sdk**          | `commands/sdk.rs`          | SDK/toolchain locator (Rust, Go, Python)   | **Unavailable**            | Native paths and binary probing                               |
| **search**       | `commands/search.rs`       | Find in files, structural search           | **Browser/WASM**           | Ripgrep in WASM or in-memory traversal                        |
| **spell**        | `commands/spell.rs`        | Spellchecking dictionary                   | **Browser/WASM**           | Pure dictionary check in WASM/JS                              |
| **ssh**          | `commands/ssh.rs`          | SSH shell & SFTP                           | **Service-Dependent**      | Sockets require backend bridge or WebSSH                      |
| **syntax**       | `commands/syntax.rs`       | Tree-sitter syntax trees & highlights      | **Browser/WASM**           | Tree-sitter WASM                                              |
| **term**         | `commands/term.rs`         | Terminal PTY allocation & data pipe        | **Unavailable / Service**  | xterm.js UI remains; PTY requires remote daemon               |
| **tools**        | `commands/tools.rs`        | External tool launchers                    | **Unavailable**            | Executing arbitrary external CLI binaries                     |
| **vcs**          | `commands/vcs.rs`          | Git operations (log, commit, diff, status) | **Browser/WASM (partial)** | Isomorphic-git/WASM for basic Git; native for full            |
| **web**          | `commands/web.rs`          | Web preview server, static previews        | **Browser API**            | Iframe / ServiceWorker preview                                |
| **window**       | `commands/window.rs`       | Secondary window creation & control        | **Browser API**            | Tabs / popups / in-page dialogs                               |
| **window_group** | `commands/window_group.rs` | Multi-window grouping & tabs               | **Browser API**            | In-page tabs                                                  |
| **workspace**    | `commands/workspace.rs`    | Multi-root workspace attach/detach         | **Browser API**            | Workspace state stored in IndexedDB                           |

## PR 7 browser command progress

The domain classification above describes migration targets, not a claim that
every command in a domain is implemented in the browser. At this stage,
`app_info` is the only product command migrated end-to-end: it returns the
package version and `web` platform, and leaves `configDir` empty because the
browser has no native configuration directory. Other commands continue to
reject as explicitly unavailable unless a browser handler is added.

The browser Welcome screen uses the existing selected-file flow and lists
persisted browser documents as recent files. Reopening a recent file routes to
the editor; removing it from recents hides it without deleting its stored
contents. Browser builds do not inject the development-only sample project.
Project folders, repository cloning, and remote development remain available
in the Tauri edition and are not yet implemented in the browser edition.

The `bytes` domain is not a pure formatting API: its current commands probe or
read bytes from native paths. It remains unimplemented for browser paths until
the browser file adapter supports the required binary operations.
