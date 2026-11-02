import { describe, expect, it } from "vitest";
import {
  getCapability,
  getUnsupportedReason,
  grantCapability,
  isAvailable,
  isUnsupported,
  requiresPermission,
} from "./capabilities";

describe("capabilities", () => {
  it("reports unsupported for native features outside Tauri", () => {
    expect(isUnsupported("process")).toBe(true);
    expect(isUnsupported("terminal")).toBe(true);
    expect(isUnsupported("lsp")).toBe(true);
    expect(isUnsupported("dap")).toBe(true);
    expect(isUnsupported("vcs")).toBe(true);
    expect(isUnsupported("database")).toBe(true);
    expect(getUnsupportedReason("process")).toContain("native runtime");
  });

  it("reports available for browser features", () => {
    expect(isAvailable("storage.indexeddb")).toBe(true);
    expect(isAvailable("storage.opfs")).toBe(true);
    expect(isAvailable("clipboard.basic")).toBe(true);
    expect(isAvailable("dialog.browser")).toBe(true);
  });

  it("reports permission-required for filesystem in browser", () => {
    expect(requiresPermission("filesystem")).toBe(true);
    expect(getCapability("filesystem").reason).toContain("File System Access API");
  });

  it("allows granting permission-required capabilities", () => {
    expect(isAvailable("filesystem")).toBe(false);
    grantCapability("filesystem");
    expect(isAvailable("filesystem")).toBe(true);
    expect(getCapability("filesystem").state).toBe("available");
  });

  it("does not grant unsupported capabilities", () => {
    grantCapability("terminal");
    expect(isUnsupported("terminal")).toBe(true);
  });
});
