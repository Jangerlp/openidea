# Web-only migration plan

## Goal and constraints

Move the product UI from the Tauri desktop shell to a browser application built
with React and Rust compiled to `wasm32-unknown-unknown`. Keep changes
incremental: the current Tauri application must continue to build and work
until the browser implementation has replaced the relevant behavior.

The browser is not a native host. WASM in a browser cannot directly access
arbitrary local paths, spawn programs, open a PTY, use native file watchers, or
open arbitrary TCP/UDP connections. Consequently, the existing IDE feature set
cannot be preserved by compiling the current backend wholesale to WASM.
Features requiring those capabilities must either:

1. be redesigned around browser-granted capabilities;
2. be explicitly out of scope for the browser edition; or
3. use a separately deployed remote service, if such a service is approved.

This plan assumes the requested end state is browser plus WASM, not a local
native companion. Any feature that needs a server must be treated as a product
scope decision, not silently implemented as a server dependency.

## Current architecture and migration impact

- The Cargo workspace includes `src-tauri` and many host crates. Tauri
  registers approximately 460 command handlers; generated
  `src/bindings.ts` contains 417 distinct invoke names. Preserve the generated
  bindings as the compatibility inventory; do not hand-edit them.
- Tauri IPC includes typed requests, events, channels/streaming, cancellation,
  and remote-development routing. Replacing `invoke` alone is not sufficient.
- Tauri imports are spread throughout the React application. Centralize
  platform access before migrating feature call sites.
- `crates/ide-vfs` provides a useful module boundary, but directly uses
  `std::fs`, native paths and metadata, and native watchers. It has no
  replaceable filesystem trait.
- Process, terminal, LSP/DAP, SSH, toolchain, database-driver, and other host
  features rely on native operating-system capabilities. They need a browser
  implementation, an explicitly unavailable state, or an approved service.
- Likely WASM candidates are pure computation (for example text/encoding,
  parsing, and selected analysis). Each candidate still needs target-specific
  dependency and feature verification.

## Target architecture

1. **React browser UI** owns browser presentation, navigation, browser-native
   dialogs, and browser-managed storage.
2. **Rust/WASM core** owns selected deterministic computation and receives
   inputs explicitly. It does not assume native paths or OS services.
3. **Browser capability adapters** implement supported file and persistence
   operations using browser APIs and user-granted permissions. Capabilities
   must be explicit, since a browser does not grant arbitrary filesystem
   access.
4. **Tauri remains a temporary compatibility platform** during migration.
   Platform-specific implementations must be selected behind interfaces, not
   introduced as scattered environment checks.
5. **No implicit native backend:** any service-backed feature is out of scope
   until its deployment, trust boundary, authentication, and data-handling
   requirements are approved.

## Pull-request sequence

Each PR should be independently reviewable and preserve the existing Tauri path.
Avoid removing native dependencies or commands while the desktop build still
uses them.

### PR 1 — Establish browser build and feature baseline

- Add a browser-only Vite entry/build mode that does not initialize Tauri APIs.
- Identify which routes/features render without a Tauri runtime; avoid changing
  their existing desktop behavior.
- Add a feature capability registry with clear `available`, `unsupported`, and
  `permission-required` states. Initially, it may only describe existing
  browser-ready features.
- Record the current frontend build/test commands and Rust workspace checks in
  CI or the project’s existing validation workflow.

**Acceptance:** the browser build starts and renders its supported shell without
Tauri globals; the existing Tauri development/build path remains unchanged.

### PR 2 — Introduce a frontend platform boundary

- Replace direct platform-specific access behind a small set of interfaces:
  IPC calls, event subscriptions, streaming channels, file open/save dialogs,
  external URL opening, window behavior, path handling, and file reveal.
- Implement the current Tauri adapter using the existing APIs and generated
  commands. Route existing callers through it without changing behavior.
- Add a browser adapter that uses browser APIs where available and reports
  unsupported capabilities explicitly.
- Include all production imports from `@tauri-apps/api` and
  `@tauri-apps/plugin-*`; keep test-only mocks clearly separate.

**Acceptance:** application feature code no longer imports Tauri APIs directly
outside the platform adapter and generated bindings; Tauri tests continue to
pass; browser startup does not import Tauri modules.

### PR 3 — Define the browser command and event contract

- Inventory commands from `src-tauri/src/commands/mod.rs` and compare against
  `src/bindings.ts`. Track each command as browser/WASM, browser API,
  unavailable, or service-dependent.
- Define typed transport interfaces for commands, errors, cancellation,
  events, and streaming. Keep the existing command argument/result types where
  they are platform-neutral.
- Implement browser-side command dispatch for a small, pure vertical slice
  before migrating broad feature areas.
- Generate or validate browser bindings from shared types; do not create a
  second manually maintained list of command signatures.
- Remove Tauri-specific `Channel` and `InvokeArgs` types from shared frontend
  interfaces. Define platform-neutral stream abstractions and adapt Tauri
  channels at the boundary.

**Acceptance:** a browser command round-trip and event/stream test pass without
`window.__TAURI_INTERNALS__`; desktop calls preserve current result and error
semantics.

### PR 4 — Extract and prove a pure Rust/WASM core

- Create a WASM-facing crate or target-specific module for computation with no
  dependency on `ide-host`, Tauri, native paths, process launch, or OS state.
- Start with isolated functions such as text encoding/decoding or selected
  syntax/analysis operations, provided their complete dependency graph supports
  the target.
- Expose a narrow `wasm-bindgen` API and async integration through
  `wasm-bindgen-futures` only where needed. Use `web-sys`/`gloo` only for
  explicit browser APIs; do not substitute them for native host capabilities.
- Add target checks and tests for both native and WASM builds. Gate native-only
  dependencies and modules with Cargo features or target-specific
  dependencies; avoid enabling native defaults in the WASM crate.

**Acceptance:** the WASM target builds in CI and browser tests validate the
selected function against native Rust test vectors.

### PR 5 — Introduce a VFS contract without changing native semantics

- Define the smallest filesystem interface needed by selected browser-ready
  operations, covering byte reads/writes, listing, metadata, and supported
  mutations. Represent unsupported capabilities (for example symlinks,
  permissions, trash, and watching) explicitly rather than approximating them.
- Move operation logic to consume the interface where doing so is practical;
  retain the current `std::fs` implementation as the native adapter.
- Preserve encoding detection, size limits, atomic-write expectations where
  possible, ignore/exclude rules, and error mapping. Document behavior that
  cannot be equivalent in browsers.
- Add an in-memory implementation for tests and browser adapter tests around
  permission denial, revoked handles, and unsupported operations.

**Acceptance:** existing VFS tests pass against the native implementation;
focused behavior tests pass against the test adapter; no browser-facing code
depends on `std::fs`.

### PR 6 — Implement browser file and persistence capabilities

- Add a browser filesystem adapter using user-selected files and, where
  supported, the File System Access API. Provide a documented fallback for
  browsers without that API.
- Use IndexedDB or another browser storage API for application-owned state;
  define versioning, migration, quota/error handling, and export/import behavior.
- Keep project file handles and permissions explicit. Do not promise arbitrary
  path access, silent background access, native watcher events, or trash
  recovery.
- Migrate one vertical slice at a time (for example open/edit/save of selected
  text files), keeping desktop behavior on the native adapter.

**Acceptance:** browser tests cover open/read/edit/save, permission denial,
storage persistence, and unsupported capabilities; desktop behavior remains
unchanged.

### PR 7 — Migrate browser-capable features incrementally

- Select each feature area from the command inventory and migrate its command
  calls to browser/WASM implementations only when its required capabilities
  exist.
- Prioritize pure features; gate process/terminal, debugger, language-server,
  toolchain, SSH, Docker, native database drivers, and native VCS operations
  until an approved browser-compatible design exists.
- Ensure unsupported actions explain why they are unavailable and do not
  appear to succeed.
- Remove each obsolete Tauri command only after its callers are migrated and
  both browser and desktop behavior are intentionally accounted for.

**Acceptance:** every shipped browser feature has an end-to-end test and an
explicit capability classification; no command is silently stubbed as a
success.

### PR 8 — Remove Tauri packaging and native-only dependencies

- Make the browser build the default deployment and remove Tauri runtime,
  plugins, scripts, generated integration, and native packaging only after the
  product's required feature set has passed its parity review.
- Remove native-only Rust crates from the WASM dependency graph; remove them
  from the repository only if no remaining native/test target requires them.
- Update CI, development instructions, documentation, and release artifacts.
- Keep a separate optional native distribution only if product scope explicitly
  retains it.

**Acceptance:** a clean checkout can build and serve the web application
without Tauri tooling; required CI checks pass; no production browser bundle
depends on Tauri packages or globals.

## Dependency review checklist

For each crate pulled into the WASM target, verify the resolved dependency
graph, enabled features, build scripts, and target-specific code. In
particular:

- Exclude Tauri and its plugins/build tools from the WASM crate.
- Do not enable Tokio `process`, `fs`, or `rt-multi-thread` for browser WASM.
  Use browser-compatible async execution only for actual browser I/O.
- Keep `notify`, `trash`, `dirs`, native `std::fs` code, `portable-pty`,
  process launch, SSH/TCP/ZMQ, and native database drivers outside the WASM
  dependency graph.
- Check `reqwest` separately: browser fetch has CORS and browser policy
  constraints and does not provide SOCKS or arbitrary socket access.
- Check `rayon`, tree-sitter grammars/build scripts, `gix`, `redb`, `sqlx`,
  `rustls`, compression/crypto crates, and each transitive C/system dependency
  against the exact target and features before adopting them.
- Avoid treating the presence of a crate in `Cargo.lock` (including
  `system-deps`) as proof it is a direct dependency or a blocker. Establish
  which target and feature pulled it in.

## Cross-cutting validation

- Keep the existing desktop build and tests green throughout the compatibility
  phase.
- Build the WASM target from a clean checkout in CI and test it in a real
  browser runtime, not only with native Rust tests.
- Test browser storage permissions, persistence/quota errors, file-handle
  revocation, CORS failures, and unsupported capabilities.
- Check generated bindings for drift and verify command inventory updates
  whenever commands are added, removed, or reclassified.
- Compare the browser bundle and dependency graph to ensure Tauri and native
  host dependencies are absent from production browser artifacts.
- Do not claim desktop feature parity unless the feature has a viable browser
  implementation and an end-to-end test.

## Decisions required before full feature parity work

1. Which IDE capabilities are mandatory for the first web release, especially
   terminal, language servers, debugger, Git, SSH, and database tools?
2. Is an authenticated remote service ever allowed, or must all execution and
   project data remain local to the browser?
3. Which browsers and minimum versions are supported, particularly for the File
   System Access API?
4. Is the Tauri app a temporary migration safety net, or must a desktop edition
   continue to be maintained?
