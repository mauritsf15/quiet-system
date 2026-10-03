const ENDPOINT = "ws://127.0.0.1:9876";
const MAX_RETRY_MS = 15_000;

function validObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalize(payload) {
  const data = payload.type === "telemetry" ? payload.data : payload;
  if (!validObject(data)) return null;
  return {
    timestamp: Number(data.timestamp) || Date.now(),
    system: validObject(data.system) ? data.system : null,
    cpu: validObject(data.cpu) ? data.cpu : null,
    gpu: validObject(data.gpu) ? data.gpu : null,
    memory: validObject(data.memory) ? data.memory : null,
    storage: validObject(data.storage) ? data.storage : null,
    network: validObject(data.network) ? data.network : null,
  };
}

export function startTelemetryClient(store, onTelemetry) {
  let socket = null;
  let retryTimer = 0;
  let attempt = 0;
  let closed = false;
  let currentRate = store.getState().settings.telemetryRate;

  function setConnection(connectionState, connected = false) {
    store.update((state) => ({ ...state, connectionState, connected }));
  }

  function scheduleRetry() {
    if (closed) return;
    const delay = Math.min(MAX_RETRY_MS, 800 * (2 ** attempt));
    attempt += 1;
    window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(connect, delay);
  }

  function sendConfiguration() {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "configure", updateIntervalMs: currentRate }));
    }
  }

  function connect() {
    setConnection(attempt === 0 ? "connecting" : "reconnecting");
    try {
      socket = new WebSocket(ENDPOINT);
    } catch {
      setConnection("offline");
      scheduleRetry();
      return;
    }

    socket.addEventListener("open", () => {
      attempt = 0;
      setConnection("active", true);
      sendConfiguration();
    });

    socket.addEventListener("message", (event) => {
      try {
        const telemetry = normalize(JSON.parse(event.data));
        if (!telemetry) return;
        const isFresh = Math.abs(Date.now() - telemetry.timestamp) < Math.max(5000, currentRate * 4);
        const identity = telemetry.system
          ? {
              username: telemetry.system.username || "user",
              hostname: telemetry.system.hostname || "host",
              os: telemetry.system.os || "Windows",
              uptimeSeconds: telemetry.system.uptimeSeconds ?? null,
            }
          : store.getState().identity;
        store.update((state) => ({
          ...state,
          connected: isFresh,
          connectionState: isFresh ? "active" : "stale",
          lastTelemetryAt: Date.now(),
          identity,
          telemetry,
        }));
        onTelemetry(telemetry);
      } catch {
        // Ignore malformed messages and retain the last valid frame.
      }
    });

    socket.addEventListener("close", () => {
      setConnection("offline");
      scheduleRetry();
    });

    socket.addEventListener("error", () => socket?.close());
  }

  const unsubscribe = store.subscribe((state) => {
    if (state.settings.telemetryRate !== currentRate) {
      currentRate = state.settings.telemetryRate;
      sendConfiguration();
    }
  });

  connect();
  return () => {
    closed = true;
    unsubscribe();
    window.clearTimeout(retryTimer);
    socket?.close();
  };
}
