import { uptime } from "../core/format.js";

const shellIdentity = document.getElementById("shell-identity");
const systemLine = document.getElementById("system-line");
const connectionLabel = document.getElementById("connection-label");
const statusMessage = document.getElementById("status-message");
const prompt = document.querySelector(".prompt");

export function renderIdentity(state) {
  const { identity, connectionState, connected } = state;
  shellIdentity.textContent = `${identity.username}@${identity.hostname}:~$ status`;
  systemLine.textContent = `${identity.os} · ${uptime(identity.uptimeSeconds)} · Wassenaar`;
  prompt.firstChild.textContent = `${identity.username}@${identity.hostname}:~$ `;
  connectionLabel.textContent = `LINK / ${connectionState.toUpperCase()}`;
  statusMessage.textContent = connected
    ? "system status / nominal"
    : connectionState === "stale"
      ? "telemetry paused / awaiting fresh sample"
    : connectionState === "connecting"
      ? "initializing local telemetry"
      : "telemetry unavailable / retry scheduled";
}
