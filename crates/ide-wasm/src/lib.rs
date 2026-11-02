use ide_core::{ChangeSet, TextChange};
use ide_text::{Document, LineEnding, normalize_line_endings};
use wasm_bindgen::prelude::*;

/// Converts a UTF-16 column to a UTF-8 byte offset, clamping to a character boundary.
#[wasm_bindgen]
pub fn utf16_col_to_byte_offset(line_text: &str, utf16_col: u32) -> u32 {
    Document::new(line_text).offset_to_byte(utf16_col) as u32
}

/// Converts a UTF-8 byte offset to a UTF-16 column, rounding down to a character boundary.
#[wasm_bindgen]
pub fn byte_offset_to_utf16_col(line_text: &str, byte_offset: u32) -> u32 {
    Document::new(line_text).byte_to_offset(byte_offset as usize)
}

/// Detect the dominant line ending in `text` ("lf", "crlf", or "cr").
#[wasm_bindgen]
pub fn detect_line_ending(text: &str) -> String {
    match LineEnding::detect(text) {
        LineEnding::Lf => "lf".to_string(),
        LineEnding::CrLf => "crlf".to_string(),
        LineEnding::Cr => "cr".to_string(),
    }
}

/// Normalizes any CRLF or CR line endings to LF.
#[wasm_bindgen]
pub fn normalize_newlines(text: &str) -> String {
    normalize_line_endings(text).into_owned()
}

/// A pure Rust rope-backed text document exposed to JavaScript / WASM.
#[wasm_bindgen]
pub struct WasmDocument {
    doc: Document,
}

#[wasm_bindgen]
impl WasmDocument {
    /// Creates a new document from the given initial text.
    #[wasm_bindgen(constructor)]
    pub fn new(text: &str) -> Self {
        Self { doc: Document::new(text) }
    }

    /// Returns the normalized content of the document.
    #[wasm_bindgen]
    pub fn text(&self) -> String {
        self.doc.text()
    }

    /// Returns the text formatted for save (with original line endings).
    #[wasm_bindgen(js_name = textForSave)]
    pub fn text_for_save(&self) -> String {
        self.doc.text_for_save()
    }

    /// Total length in UTF-16 code units (as used by JS and CodeMirror).
    #[wasm_bindgen(js_name = lenUtf16)]
    pub fn len_utf16(&self) -> u32 {
        self.doc.len_utf16()
    }

    /// Total number of lines in the document.
    #[wasm_bindgen(js_name = lineCount)]
    pub fn line_count(&self) -> u32 {
        self.doc.line_count()
    }

    /// Returns the text of a single line (0-indexed) without the trailing newline.
    #[wasm_bindgen]
    pub fn line(&self, line: u32) -> Option<String> {
        self.doc.line(line)
    }

    /// Extracts a slice of text between two UTF-16 offsets.
    #[wasm_bindgen]
    pub fn slice(&self, from: u32, to: u32) -> String {
        self.doc.slice(from, to)
    }

    /// The detected line ending of this document.
    #[wasm_bindgen(js_name = lineEnding)]
    pub fn line_ending(&self) -> String {
        match self.doc.line_ending() {
            LineEnding::Lf => "lf".to_string(),
            LineEnding::CrLf => "crlf".to_string(),
            LineEnding::Cr => "cr".to_string(),
        }
    }

    /// Replaces a range of UTF-16 offsets and preserves the document's line ending.
    #[wasm_bindgen(js_name = applyEdit)]
    pub fn apply_edit(&mut self, from: u32, to: u32, replacement: &str) -> Result<(), JsValue> {
        let changes = ChangeSet { changes: vec![TextChange { from, to, insert: replacement.to_owned() }] };
        self.doc.apply(self.doc.version(), &changes).map(|_| ()).map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coordinate_conversions_handle_surrogate_pairs_and_utf8_bytes() {
        let text = "abc🚀z";

        assert_eq!(utf16_col_to_byte_offset(text, 4), 3);
        assert_eq!(utf16_col_to_byte_offset(text, 5), 7);
        assert_eq!(byte_offset_to_utf16_col(text, 4), 3);
        assert_eq!(byte_offset_to_utf16_col(text, 7), 5);
    }

    #[test]
    fn document_edits_preserve_line_endings_and_utf16_offsets() {
        let mut document = WasmDocument::new("a\r\n🚀b\r\n");

        document.apply_edit(2, 4, "🙂").unwrap();

        assert_eq!(document.text(), "a\n🙂b\n");
        assert_eq!(document.text_for_save(), "a\r\n🙂b\r\n");
        assert_eq!(document.len_utf16(), 6);
    }
}
