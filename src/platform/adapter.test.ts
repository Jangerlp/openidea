import { describe, expect, it, vi } from "vitest";
import { getPlatform, platformDialog, platformEvents, platformPath, platformWindow } from "./adapter";

describe("PlatformAdapter", () => {
  it("provides non-null adapter instances for all domains", () => {
    const platform = getPlatform();
    expect(platform).toBeDefined();
    expect(platform.dialog).toBeDefined();
    expect(platform.opener).toBeDefined();
    expect(platform.window).toBeDefined();
    expect(platform.path).toBeDefined();
    expect(platform.events).toBeDefined();
  });

  it("handles path joins platform-neutrally", async () => {
    const joined = await platformPath.join("a", "b", "c");
    expect(joined).toBe("a/b/c");
  });

  it("browser events allow emitting and listening", async () => {
    const fn = vi.fn();
    const unsub = await platformEvents.listen<string>("test:event", fn);

    await platformEvents.emit("test:event", "hello world");
    expect(fn).toHaveBeenCalledWith("hello world");

    unsub();
    await platformEvents.emit("test:event", "second");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("browser window title changes document title when present", async () => {
    await platformWindow.setTitle("Test Title");
    if (typeof document !== "undefined") {
      expect(document.title).toBe("Test Title");
    }
  });

  it("reports directory selection as unsupported in the browser", async () => {
    await expect(platformDialog.open({ directory: true })).rejects.toMatchObject({
      kind: "unsupported",
    });
  });
});
