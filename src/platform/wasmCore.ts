/**
 * Pure WebAssembly Core Loader and Bridge.
 *
 * Exposes deterministic computation compiled from Rust (`crates/ide-wasm`,
 * `ide-core`, `ide-text`) directly in the browser without any native host dependencies.
 */

import initWasm, {
  byte_offset_to_utf16_col,
  detect_line_ending,
  normalize_newlines,
  utf16_col_to_byte_offset,
  WasmDocument,
  type InitOutput,
} from "../wasm/ide_wasm";
import wasmUrl from "../wasm/ide_wasm_bg.wasm?url";

let wasmReady: Promise<InitOutput> | null = null;

/** Ensures the WASM binary is fetched, compiled, and instantiated. */
export async function ensureWasmCore(): Promise<InitOutput> {
  if (!wasmReady) {
    wasmReady = initWasm(wasmUrl);
  }
  return wasmReady;
}

export { byte_offset_to_utf16_col, detect_line_ending, normalize_newlines, utf16_col_to_byte_offset, WasmDocument };
