import WebSocket from "ws";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";

const filePath = process.argv[2];
const outPath = process.argv[3];
const actions = process.argv[4];
const port = 9333 + Math.floor(Math.random() * 2000);
const profileDir = "/tmp/cdp-profile-" + Date.now() + "-" + Math.floor(Math.random()*10000);

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  `--remote-debugging-port=${port}`, "--headless=new", "--disable-gpu",
  `--user-data-dir=${profileDir}`, "--no-first-run", "--hide-scrollbars",
], { stdio: "ignore" });

function cleanup() { try { execSync(`pkill -9 -f "${profileDir}"`); } catch (e) {} }

async function main() {
  let browserWsUrl = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 300));
    try {
      const res = await fetch(`http://localhost:${port}/json/version`);
      const v = await res.json();
      browserWsUrl = v.webSocketDebuggerUrl;
      break;
    } catch (e) {}
  }
  if (!browserWsUrl) throw new Error("no browser endpoint");

  const bws = new WebSocket(browserWsUrl);
  let id = 0; const pending = new Map();
  bws.on("message", (data) => { const msg = JSON.parse(data.toString()); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
  function bsend(method, params = {}) { return new Promise((resolve) => { const thisId = ++id; pending.set(thisId, resolve); bws.send(JSON.stringify({ id: thisId, method, params })); }); }
  await new Promise((resolve, reject) => { bws.on("open", resolve); bws.on("error", reject); });

  const created = await bsend("Target.createTarget", { url: "about:blank", width: 1600, height: 1000, newWindow: true });
  const targetId = created.result.targetId;
  const attached = await bsend("Target.attachToTarget", { targetId, flatten: true });
  const sessionId = attached.result.sessionId;

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const thisId = ++id;
      pending.set(thisId, resolve);
      bws.send(JSON.stringify({ id: thisId, method, params, sessionId }));
    });
  }

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "file://" + filePath });
  await new Promise(r => setTimeout(r, 1200));
  if (actions) {
    await send("Runtime.evaluate", { expression: actions, awaitPromise: true, returnByValue: true });
    await new Promise(r => setTimeout(r, 400));
  }
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1600, height: 1000, scale: 1 } });
  fs.writeFileSync(outPath, Buffer.from(shot.result.data, "base64"));
  bws.close();
}

main().then(() => { cleanup(); process.exit(0); }).catch((e) => { console.error(e); cleanup(); process.exit(1); });
setTimeout(() => { console.error("TIMEOUT"); cleanup(); process.exit(1); }, 20000);
