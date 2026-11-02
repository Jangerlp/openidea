import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import { commands, invoke, StreamChannel, type IdeError } from "./ipc";
import { dispatchBrowserCommand, installBrowserDispatch, registerBrowserCommand } from "./browserDispatch";
import { loadPlatformInfo, usePlatform } from "./platformInfo";

describe("browser command dispatch", () => {
  it("runs without window.__TAURI_INTERNALS__", () => {
    expect((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__).toBeUndefined();
  });

  it("handles app_info round-trip via commands wrapper", async () => {
    installBrowserDispatch();
    const info = await commands.appInfo();
    expect(info).toBeDefined();
    expect(info.platform).toBe("web");
    expect(info.version).toBe(packageJson.version);
    expect(info.configDir).toBe("");
  });

  it("loads browser metadata without enabling native title-bar behavior", async () => {
    const previous = usePlatform.getState();
    usePlatform.setState({ os: "windows", version: null, overlayTitleBar: true, framelessTitleBar: true });

    await loadPlatformInfo();

    expect(usePlatform.getState()).toMatchObject({
      os: "web",
      version: packageJson.version,
      overlayTitleBar: false,
      framelessTitleBar: false,
    });
    usePlatform.setState(previous);
  });

  it("handles request cancellation tracking", async () => {
    await dispatchBrowserCommand("cancel_request", { id: 42 });
    const isCancelled = await dispatchBrowserCommand("is_request_cancelled", { id: 42 });
    expect(isCancelled).toBe(true);

    const otherCancelled = await dispatchBrowserCommand("is_request_cancelled", { id: 99 });
    expect(otherCancelled).toBe(false);
  });

  it("handles streaming commands via StreamChannel", async () => {
    const stream = new StreamChannel<string>();
    const received: string[] = [];
    stream.onmessage = (chunk) => received.push(chunk);

    const result = await dispatchBrowserCommand<{ total: number }>("stream_echo", {
      channel: stream,
      count: 4,
    });

    expect(result.total).toBe(4);
    expect(received).toEqual(["chunk-1", "chunk-2", "chunk-3", "chunk-4"]);
  });

  it("rejects unregistered commands with typed unavailable error", async () => {
    try {
      await invoke("unsupported_native_cmd");
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as IdeError;
      expect(err.kind).toBe("unavailable");
      expect(err.message).toContain("unsupported_native_cmd");
    }
  });

  it("supports dynamic command registration and cleanup", async () => {
    const cleanup = registerBrowserCommand("custom_test_cmd", ({ val }: { val: number }) => val * 2);

    const res = await invoke<number>("custom_test_cmd", { val: 21 });
    expect(res).toBe(42);

    cleanup();

    await expect(invoke("custom_test_cmd", { val: 21 })).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
});
