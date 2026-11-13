type Listener = (e: Event) => void;

// Maps original callbacks to their wrapped listeners, per event name,
// so remove() can detach them.
const listeners = new Map<string, Map<(data: any) => unknown, Listener>>();

const UIEventBus = {
    on<T = any>(event: string, callback: (data: T) => unknown) {
        const listener: Listener = (e: Event) =>
            callback((e as CustomEvent).detail);
        let byCallback = listeners.get(event);
        if (!byCallback) {
            byCallback = new Map();
            listeners.set(event, byCallback);
        }
        byCallback.set(callback, listener);
        document.addEventListener(event, listener);
    },
    dispatch(event: string, data?: unknown) {
        document.dispatchEvent(new CustomEvent(event, { detail: data }));
    },
    remove<T = any>(event: string, callback: (data: T) => unknown) {
        const byCallback = listeners.get(event);
        const listener = byCallback?.get(callback);
        if (!listener) return;
        document.removeEventListener(event, listener);
        byCallback!.delete(callback);
    },
};

export default UIEventBus;
