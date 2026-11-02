/**
 * Platform-neutral streaming channel abstraction.
 *
 * Replaces direct reliance on `@tauri-apps/api/core` `Channel` in feature code.
 * In desktop mode, channels are converted to/from Tauri IPC channels at the
 * transport boundary. In browser mode, messages are dispatched directly in-memory.
 */

export interface StreamListener<T> {
  (data: T): void;
}

export class StreamChannel<T> {
  private static nextId = 1;

  readonly id: number;
  readonly __TAURI_CHANNEL_MARKER__ = true as const;

  /** Callback invoked whenever a message arrives from the producer. */
  onmessage: StreamListener<T> = () => {};

  private closed = false;

  constructor() {
    this.id = StreamChannel.nextId++;
  }

  /**
   * Emits data to the listener. Used by the producer (browser command handler or
   * desktop IPC bridge).
   */
  send(data: T): void {
    if (this.closed) return;
    try {
      this.onmessage(data);
    } catch (e) {
      console.error(`Error in StreamChannel #${this.id} listener:`, e);
    }
  }

  /** Closes the stream channel and unhooks any active listener. */
  close(): void {
    this.closed = true;
    this.onmessage = () => {};
  }

  /**
   * Serialization contract: Tauri's IPC transport identifies channels by this
   * JSON representation.
   */
  toJSON(): string {
    return `__CHANNEL__:${this.id}`;
  }
}

/** Creates a new platform-neutral stream channel. */
export function createStream<T>(): StreamChannel<T> {
  return new StreamChannel<T>();
}
