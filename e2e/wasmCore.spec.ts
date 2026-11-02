import { expect, test } from "@playwright/test";

test("loads the Rust WASM core in the browser and matches its native test vectors", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const modulePath = "/src/platform/wasmCore.ts";
    const core = await import(modulePath);
    await core.ensureWasmCore();

    const text = "abc🚀z";
    const document = new core.WasmDocument("a\r\n🚀b\r\n");
    document.applyEdit(2, 4, "🙂");

    return {
      lineEnding: core.detect_line_ending("one\r\ntwo\r\n"),
      normalized: core.normalize_newlines("one\r\ntwo\r"),
      utf16ToByte: core.utf16_col_to_byte_offset(text, 5),
      byteToUtf16: core.byte_offset_to_utf16_col(text, 7),
      editedText: document.text(),
      savedText: document.textForSave(),
      utf16Length: document.lenUtf16(),
    };
  });

  expect(result).toEqual({
    lineEnding: "crlf",
    normalized: "one\ntwo\n",
    utf16ToByte: 7,
    byteToUtf16: 5,
    editedText: "a\n🙂b\n",
    savedText: "a\r\n🙂b\r\n",
    utf16Length: 6,
  });
});
