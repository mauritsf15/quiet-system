async function waitForHealth() {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await fetch("http://127.0.0.1:9876/health").then((response) => response.json());
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

const health = await waitForHealth();
if (!['ready', 'starting'].includes(health.status)) throw new Error(`Unexpected health state: ${health.status}`);

const socket = new WebSocket("ws://127.0.0.1:9876/");
const payload = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Timed out waiting for telemetry")), 8000);
  socket.addEventListener("message", (event) => {
    clearTimeout(timeout);
    resolve(JSON.parse(event.data));
  }, { once: true });
  socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true });
});

socket.close();
if (payload.type !== "telemetry" || !payload.data?.system?.hostname) {
  throw new Error("Telemetry payload did not match the expected schema");
}

process.stdout.write(JSON.stringify({
  health: health.status,
  hostname: payload.data.system.hostname,
  sensors: {
    cpu: Boolean(payload.data.cpu),
    gpu: Boolean(payload.data.gpu),
    memory: Boolean(payload.data.memory),
    storage: Boolean(payload.data.storage),
    network: Boolean(payload.data.network),
  },
  sample: {
    cpu: payload.data.cpu,
    memory: payload.data.memory,
    network: payload.data.network,
  },
}, null, 2));
