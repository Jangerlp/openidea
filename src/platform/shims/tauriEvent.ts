/** Browser-mode shim for @tauri-apps/api/event. */
export type UnlistenFn = () => void;
export type EventCallback<T> = (event: { payload: T }) => void;

export async function listen<T>(_event: string, _handler: EventCallback<T>): Promise<UnlistenFn> {
  return () => {};
}

export async function emit(_event: string, _payload?: unknown): Promise<void> {}

export async function emitTo(_target: string, _event: string, _payload?: unknown): Promise<void> {}

export async function once<T>(_event: string, _handler: EventCallback<T>): Promise<UnlistenFn> {
  return () => {};
}
