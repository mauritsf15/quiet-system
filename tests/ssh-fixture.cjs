// Loopback-only SSH server with ephemeral host keys and dummy credentials.
const { generateKeyPairSync } = require("node:crypto");
const { Server } = require("ssh2");
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" },
});
const server = new Server({ hostKeys: [privateKey] }, client => {
  client.on("error", () => {});
  client.on("authentication", context => {
    if (context.method === "password" && context.username === "quiet-test" && context.password === "quiet-dummy-password") context.accept();
    else context.reject(["password"]);
  });
  client.on("ready", () => client.on("session", accept => {
    const session = accept();
    session.on("pty", accept => accept());
    session.on("window-change", accept => accept?.());
    session.on("shell", accept => {
      const stream = accept();
      stream.write("ssh-shell-ready\r\n$ ");
      let pending = "";
      stream.on("data", data => {
        if (data.includes(3)) { stream.write("ssh-interrupted\r\n$ "); return; }
        pending += data.toString();
        let newline;
        while ((newline = pending.search(/[\r\n]/)) >= 0) {
          const command = pending.slice(0, newline).trim();
          pending = pending.slice(newline + 1);
          if (command === "echo remote-ok") stream.write("remote-ok\r\n$ ");
          if (command === "exit") { stream.exit(0); stream.end(); }
        }
      });
    });
  }));
});
server.listen(0, "127.0.0.1", () => console.log(server.address().port));
