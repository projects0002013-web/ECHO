/* Shared, explicit mobile host handshake. On GitHub Pages no native bridge is exposed. */
(() => {
  "use strict";
  const android = window.EchoAndroid && typeof window.EchoAndroid.request === "function";
  const ios = window.webkit?.messageHandlers?.echoNative;
  if (!android && !ios) return;
  const pending = new Map();
  let sequence = 0;
  // Called only by the native app shell. Never treat native status as proof of successful inference.
  window.echoNativeReply = (id, payload) => {
    const p = pending.get(String(id));
    if (!p) return;
    pending.delete(String(id));
    p.cleanup?.();
    if (payload && payload.error) p.reject(new Error(String(payload.error)));
    else p.resolve(payload);
  };
  function request(type, data = {}, signal) {
    if (signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
    const id = String(++sequence);
    return new Promise((resolve, reject) => {
      const abort = () => {
        pending.delete(id);
        try {
          if (android) window.EchoAndroid.request(JSON.stringify({ id, type: "cancel" }));
          else ios.postMessage({ id, type: "cancel" });
        } catch (_) {}
        reject(new DOMException("Cancelled", "AbortError"));
      };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        if (android) window.EchoAndroid.request(JSON.stringify({ id, type, ...data }));
        else ios.postMessage({ id, type, ...data });
      } catch (error) {
        pending.delete(id); cleanup(); reject(error);
      }
    });
  }
  window.echoNativeVoice = Object.freeze({
    status: () => request("status"),
    deviceCapabilities: () => request("deviceCapabilities"),
    deviceTtsStatus: () => request("deviceTtsStatus"),
    speakDevice: (text, language) => request("deviceSpeak", { text, language }),
    stopDevice: () => request("deviceStop"),
    requestMicrophonePermission: () => request("microphonePermission"),
    synthesize: ({ text, language, referenceWavBase64, signal }) => {
      if (typeof text !== "string" || text.length === 0 || text.length > 300)
        return Promise.reject(new Error("Некорректный текст."));
      if (typeof referenceWavBase64 !== "string" || referenceWavBase64.length > 16 * 1024 * 1024)
        return Promise.reject(new Error("Слишком большой голосовой образец."));
      return request("synthesize", { text, language, referenceWavBase64 }, signal);
    }
  });
})();
