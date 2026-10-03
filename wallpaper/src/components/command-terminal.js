const byId = (id) => document.getElementById(id);

export function installCommandTerminal({ localCompanion }) {
  const output = byId("command-output");
  const input = byId("command-input");
  const runButton = byId("run-button");
  const stopButton = byId("stop-button");
  const connection = byId("command-connection");
  const help = byId("command-help");
  const cwdLabel = byId("command-cwd");
  let socket;
  let retryTimer;
  let stopped = false;
  let current = null;
  let cwd = "~";
  const history = [];
  let historyIndex = 0;
  const entries = new Map();

  function terminalAppearance() {
    const style = getComputedStyle(document.body);
    return {
      fontFamily: style.fontFamily,
      fontSize: parseFloat(style.fontSize),
      theme: { background: style.getPropertyValue("--bg").trim(), foreground: style.getPropertyValue("--text").trim(), cursor: style.getPropertyValue("--accent").trim() },
    };
  }
  function fitCompletedEntry(entry) {
    // Reflow at the normal output height before compacting short command results.
    entry.host.style.height = "";
    entry.fit.fit();
    const buffer = entry.terminal.buffer.active;
    const lines = Math.max(1, Math.min(entry.terminal.rows, buffer.baseY + buffer.cursorY + 1));
    const screen = entry.terminal.element.querySelector(".xterm-screen");
    const cellHeight = screen.getBoundingClientRect().height / entry.terminal.rows;
    entry.host.style.height = `${Math.ceil(lines * cellHeight + 8)}px`;
    entry.fit.fit();
  }
  const appearanceObserver = new MutationObserver(() => {
    if (!entries.size) return;
    const appearance = terminalAppearance();
    for (const entry of entries.values()) {
      entry.terminal.options.fontFamily = appearance.fontFamily;
      entry.terminal.options.fontSize = appearance.fontSize;
      entry.terminal.options.theme = appearance.theme;
      if (entry.host.clientWidth > 0 && entry.host.clientHeight > 0) {
        if (entry.finished) fitCompletedEntry(entry);
        else if (current === entry.id) entry.fit.fit();
      }
    }
  });
  appearanceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });

  function setReady(ready) {
    input.disabled = !ready;
    input.type = current ? "password" : "text";
    input.setAttribute("aria-label", current ? "Session reply (hidden)" : "PowerShell command");
    runButton.disabled = !ready;
    runButton.textContent = current ? "SEND ↵" : "RUN ↵";
    stopButton.hidden = !current;
    stopButton.disabled = !ready;
    input.placeholder = current ? "Enter a reply (hidden)…" : "Enter a command…";
    connection.textContent = ready ? "READY" : "OFFLINE";
    help.textContent = ready
      ? current ? "Reply below · Enter sends · Replies hidden · STOP ends session · Click output for direct typing" : "↑↓ History  ·  clear  ·  Interactive commands supported"
      : "Local command service unavailable";
  }
  function scrollBottom() { output.scrollTop = output.scrollHeight; }
  function appendLine(text, className = "") {
    const line = document.createElement("div");
    line.className = className;
    line.textContent = text;
    output.appendChild(line);
    scrollBottom();
  }
  function updateRunningStatus(entry) {
    entry.status.textContent = `${entry.phase} · ${((performance.now() - entry.startedAt) / 1000).toFixed(1)}s`;
  }
  function finishEntry(entry, message) {
    entry.finished = true;
    window.clearInterval(entry.timer);
    entry.status.classList.remove("is-running");
    entry.status.textContent = message;
    entry.terminal.options.disableStdin = true;
    entry.resizeObserver.disconnect();
    // Preserve the rendered scrollback while returning short commands to a compact layout.
    entry.terminal.write("", () => {
      if (!entries.has(entry.id)) return;
      fitCompletedEntry(entry);
    });
  }
  function clearEntries() {
    for (const entry of entries.values()) {
      window.clearInterval(entry.timer);
      entry.resizeObserver.disconnect();
      entry.terminal.dispose();
    }
    entries.clear();
    output.replaceChildren();
  }
  function sendInput(id, text) {
    if (current !== id || socket?.readyState !== WebSocket.OPEN) return;
    // Input goes only to ConPTY. Passwords are never echoed here or added to history.
    let chunk = "";
    for (const character of text) {
      chunk += character;
      if (chunk.length >= 2048) { socket.send(JSON.stringify({ type: "input", id, text: chunk })); chunk = ""; }
    }
    if (chunk) socket.send(JSON.stringify({ type: "input", id, text: chunk }));
  }
  function makeEntry(id, command) {
    const entry = document.createElement("div");
    entry.className = "command-entry";
    const heading = document.createElement("div");
    heading.className = "entry-command";
    const path = document.createElement("span");
    path.className = "entry-cwd";
    path.textContent = cwd;
    const sign = document.createElement("span");
    sign.className = "entry-sign";
    sign.textContent = "❯";
    heading.append(path, sign, document.createTextNode(command));
    const host = document.createElement("div");
    host.className = "entry-terminal";
    host.setAttribute("aria-label", "Interactive command output");
    const stderr = document.createElement("pre");
    stderr.className = "entry-output is-error";
    const status = document.createElement("div");
    status.className = "entry-status is-running";
    entry.append(heading, host, stderr, status);
    output.appendChild(entry);
    const terminal = new window.Terminal({
      cols: 80, rows: 18, scrollback: 5000, cursorBlink: true,
      ...terminalAppearance(), lineHeight: 1.3,
      allowProposedApi: false, screenReaderMode: true,
    });
    const fit = new window.FitAddon.FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();
    const record = { id, host, terminal, fit, stderr, status, finished: false, startedAt: performance.now(), phase: "starting PowerShell" };
    terminal.onData((text) => sendInput(id, text));
    // Keep Ctrl+C in the console; it interrupts SSH's foreground command normally.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "c") {
        if (terminal.hasSelection()) return false;
        if (event.type === "keydown") { event.preventDefault(); sendInput(id, "\u0003"); }
        return false;
      }
      return true;
    });
    terminal.onResize(({ cols, rows }) => {
      if (!record.finished && current === id && socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "resize", id, cols, rows }));
    });
    record.resizeObserver = new ResizeObserver(() => {
      if (current === id && host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
    });
    record.resizeObserver.observe(host);
    updateRunningStatus(record);
    record.timer = window.setInterval(() => updateRunningStatus(record), 200);
    entries.set(id, record);
    scrollBottom();
    terminal.focus();
    return record;
  }
  function handle(packet) {
    if (packet.cwd) { cwd = packet.cwd; cwdLabel.textContent = cwd; cwdLabel.title = cwd; }
    if (packet.type === "ready") {
      if (packet.username && packet.hostname) byId("shell-identity").textContent = `${packet.username}@${packet.hostname}`;
      setReady(true); input.focus(); return;
    }
    const entry = entries.get(packet.id);
    if (!entry) return;
    if (["start", "stdout", "stderr"].includes(packet.type) && entry.phase !== "stopping") { entry.phase = "running"; updateRunningStatus(entry); }
    if (packet.type === "stdout") entry.terminal.write(packet.text || "");
    if (packet.type === "stderr") entry.stderr.textContent += packet.text || "";
    if (packet.type === "error") entry.stderr.textContent += `${packet.message}\n`;
    if (packet.type === "exit") {
      const duration = `${((performance.now() - entry.startedAt) / 1000).toFixed(1)}s`;
      finishEntry(entry, packet.code === 0 ? `completed · exit 0 · ${duration}` : `finished · exit ${packet.code} · ${duration}`);
      current = null;
      input.value = "";
      setReady(socket?.readyState === WebSocket.OPEN);
      input.focus();
    }
    scrollBottom();
  }
  async function connect() {
    if (stopped) return;
    try {
      const response = await fetch("/api/session", { cache: "no-store" });
      if (!response.ok) throw new Error("session unavailable");
      const { token } = await response.json();
      if (stopped) return;
      socket = new WebSocket(`ws://127.0.0.1:9876/commands?token=${encodeURIComponent(token)}`);
      socket.addEventListener("message", (event) => { try { handle(JSON.parse(event.data)); } catch { /* Ignore malformed messages. */ } });
      socket.addEventListener("close", () => {
        if (current) { const entry = entries.get(current); if (entry) finishEntry(entry, "connection lost"); current = null; input.value = ""; }
        setReady(false);
        if (!stopped) retryTimer = window.setTimeout(connect, 2500);
      });
      socket.addEventListener("error", () => socket.close());
    } catch {
      setReady(false);
      if (!stopped) retryTimer = window.setTimeout(connect, 2500);
    }
  }
  byId("command-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (current && socket?.readyState === WebSocket.OPEN) {
      const reply = input.value;
      input.value = "";
      sendInput(current, `${reply}\r`);
      input.focus();
      return;
    }
    const command = input.value.trim();
    if (!command || current || socket?.readyState !== WebSocket.OPEN) return;
    if (typeof window.Terminal !== "function" || !window.FitAddon?.FitAddon) {
      appendLine("The interactive terminal could not load. Reload this page and try again.", "entry-output is-error");
      return;
    }
    input.value = "";
    if (command === "clear") { clearEntries(); return; }
    history.push(command);
    historyIndex = history.length;
    current = crypto.randomUUID();
    const entry = makeEntry(current, command);
    setReady(true);
    socket.send(JSON.stringify({ type: "run", protocol: 2, id: current, command, cols: entry.terminal.cols, rows: entry.terminal.rows }));
    input.focus();
  });
  stopButton.addEventListener("click", () => {
    if (!current || socket?.readyState !== WebSocket.OPEN) return;
    input.value = "";
    socket.send(JSON.stringify({ type: "cancel", id: current }));
    const entry = entries.get(current);
    if (entry) { entry.phase = "stopping"; updateRunningStatus(entry); }
  });
  input.addEventListener("keydown", (event) => {
    if (current) return; // Replies, including passwords, never enter command history.
    if (event.key === "ArrowUp" && historyIndex > 0) { event.preventDefault(); input.value = history[--historyIndex]; }
    if (event.key === "ArrowDown" && historyIndex < history.length) { event.preventDefault(); input.value = ++historyIndex === history.length ? "" : history[historyIndex]; }
  });
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.target.closest?.(".entry-terminal")) return;
    if (event.ctrlKey && event.key.toLowerCase() === "c" && current && !window.getSelection()?.toString()) {
      event.preventDefault(); sendInput(current, "\u0003");
      const entry = entries.get(current);
      entry?.terminal.focus();
    }
  });
  byId("clear-button").addEventListener("click", () => { if (!current) clearEntries(); });
  if (localCompanion) connect();
  else { setReady(false); appendLine("Command service unavailable in this preview.", "entry-status"); }
  return () => { stopped = true; appearanceObserver.disconnect(); window.clearTimeout(retryTimer); clearEntries(); socket?.close(); };
}
