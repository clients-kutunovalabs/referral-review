// A throwaway SMTP server for testing: accepts any mail, remembers it, and lets the test ask for the latest code per recipient.
import net from "node:net";
import http from "node:http";

const mails = [];
net.createServer((sock) => {
  let inData = false; let buf = ""; let to = ""; let body = "";
  const send = (l) => sock.write(l + "\r\n");
  send("220 sink ESMTP");
  sock.on("data", (d) => {
    buf += d.toString();
    for (;;) {
      if (inData) {
        const end = buf.indexOf("\r\n.\r\n");
        if (end < 0) return;
        body = buf.slice(0, end); buf = buf.slice(end + 5); inData = false;
        const code = /code is (\d{6})/.exec(body)?.[1];
        const subject = /^Subject: (.*)$/m.exec(body)?.[1];
        mails.push({ to, code, subject, at: Date.now() });
        send("250 OK queued");
        continue;
      }
      const nl = buf.indexOf("\r\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl); buf = buf.slice(nl + 2);
      const cmd = line.toUpperCase();
      if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) send("250-sink\r\n250 8BITMIME");
      else if (cmd.startsWith("MAIL FROM")) send("250 OK");
      else if (cmd.startsWith("RCPT TO")) { to = /<([^>]+)>/.exec(line)?.[1] ?? ""; send("250 OK"); }
      else if (cmd === "DATA") { inData = true; send("354 go"); }
      else if (cmd === "QUIT") { send("221 bye"); sock.end(); }
      else send("250 OK");
    }
  });
  sock.on("error", () => {});
}).listen(2525, "127.0.0.1");

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const to = u.searchParams.get("to");
  const list = mails.filter((m) => !to || m.to.toLowerCase() === to.toLowerCase());
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(u.pathname === "/all" ? list : list.at(-1) ?? null));
}).listen(2526, "127.0.0.1");
console.log("smtp sink on 2525, query on 2526");
