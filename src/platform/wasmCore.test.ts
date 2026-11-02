import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  initSync,
  byte_offset_to_utf16_col,
  detect_line_ending,
  normalize_newlines,
  utf16_col_to_byte_offset,
  WasmDocument,
} from "../wasm/ide_wasm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmBuffer = readFileSync(join(__dirname, "../wasm/ide_wasm_bg.wasm"));

// Synchronously initialize the compiled WASM module for the Node/Vitest test runner
initSync(wasmBuffer);

describe("Rust/WASM Core", () => {
  describe("UTF-16 and UTF-8 coordinate conversion", () => {
    it("rounds offsets inside surrogate pairs and multibyte characters down", () => {
      const text = "abc🚀z";

      expect(utf16_col_to_byte_offset(text, 4)).toBe(3);
      expect(utf16_col_to_byte_offset(text, 5)).toBe(7);
      expect(byte_offset_to_utf16_col(text, 4)).toBe(3);
      expect(byte_offset_to_utf16_col(text, 7)).toBe(5);
    });
  });

  describe("detect_line_ending", () => {
    it("detects LF", () => {
      expect(detect_line_ending("hello\nworld\n")).toBe("lf");
    });

    it("detects CRLF", () => {
      expect(detect_line_ending("hello\r\nworld\r\n")).toBe("crlf");
    });

    it("detects CR", () => {
      expect(detect_line_ending("hello\rworld\r")).toBe("cr");
    });
  });

  describe("normalize_newlines", () => {
    it("converts CRLF to LF", () => {
      expect(normalize_newlines("line1\r\nline2\r\n")).toBe("line1\nline2\n");
    });

    it("leaves pure LF unchanged", () => {
      expect(normalize_newlines("line1\nline2\n")).toBe("line1\nline2\n");
    });
  });

  describe("WasmDocument (rope-backed text document)", () => {
    it("manages text, line counts, and UTF-16 metrics", () => {
      const doc = new WasmDocument("Line 1\r\nLine 2 with 🚀 emoji\r\nLine 3");

      expect(doc.lineCount()).toBe(3);
      expect(doc.lineEnding()).toBe("crlf");
      expect(doc.line(0)).toBe("Line 1");
      expect(doc.line(1)).toBe("Line 2 with 🚀 emoji");
      expect(doc.line(2)).toBe("Line 3");

      // Verify UTF-16 slicing (emoji 🚀 is 2 code units)
      const slice = doc.slice(0, 6);
      expect(slice).toBe("Line 1");

      // textForSave preserves the original CRLF line endings
      expect(doc.textForSave()).toBe("Line 1\r\nLine 2 with 🚀 emoji\r\nLine 3");
    });

    it("applies UTF-16 edits and preserves the detected line ending", () => {
      const doc = new WasmDocument("a\r\n🚀b\r\n");

      doc.applyEdit(2, 4, "🙂");

      expect(doc.text()).toBe("a\n🙂b\n");
      expect(doc.textForSave()).toBe("a\r\n🙂b\r\n");
      expect(doc.lenUtf16()).toBe(6);
    });
  });
});
