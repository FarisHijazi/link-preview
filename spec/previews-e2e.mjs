// Headless end-to-end check of the link-preview triggers against the BUILT
// extension (build/chrome-dev). Run after `npm run build`:
//
//   CHROME_PATH=/path/to/chrome-for-testing node spec/previews-e2e.mjs
//
// Branded Chrome >= 137 ignores --load-extension, so point CHROME_PATH at
// Chrome for Testing / Chromium. Runs in --headless=new: no window appears.
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extDir = path.join(root, "build/chrome-dev");
const chromePath = process.env.CHROME_PATH;
if (!chromePath) {
  console.error("Set CHROME_PATH to a Chrome for Testing / Chromium binary.");
  process.exit(2);
}

// One server, reached as two hosts (localhost vs 127.0.0.1) so links are
// cross-site from the page under test.
const page = (body) =>
  `<!doctype html><html><body style="margin:0;font:16px sans-serif">${body}</body></html>`;
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  if (req.url.startsWith("/target")) {
    res.end(page(`<h1>target ${req.url}</h1>`));
    return;
  }
  res.end(
    page(`
    <div style="padding:40px">
      <p><a id="cross" href="http://127.0.0.1:${port}/target-cross">cross-site link</a></p>
      <p><a id="same" href="/target-same">same-site link</a></p>
      <p><a id="blank" target="_blank" href="http://127.0.0.1:${port}/target-blank">new-tab link</a></p>
      <p id="plain" style="height:40px">plain text, not a link</p>
      <div id="spa"></div>
    </div>
    <div style="height:3000px"></div>`),
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const base = `http://localhost:${port}/`;

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: false, // --headless=new below; puppeteer 19's "true" is old headless (no extensions)
  ignoreDefaultArgs: ["--disable-extensions", "--enable-automation"],
  args: [
    "--headless=new",
    "--no-sandbox",
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    "--window-size=1280,900",
  ],
  defaultViewport: { width: 1280, height: 900 },
});

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const previewUrl = (p) =>
  p.evaluate(() => {
    const host = document.querySelector("search-preview-window");
    const root = host?.shadowRoot ?? host;
    const wb =
      root?.querySelector?.(".winbox") ?? document.querySelector(".winbox");
    if (!wb || wb.classList.contains("sp-glance-out")) return null;
    return wb.querySelector("iframe")?.src ?? "";
  });
const center = async (p, sel) => {
  const r = await p.$eval(sel, (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  return r;
};

async function freshPage() {
  const p = await browser.newPage();
  await p.goto(base, { waitUntil: "load" });
  await sleep(300); // content script injects at document_idle
  return p;
}

// Writes extension settings through the options page (chrome.storage.sync).
async function setSettings(values) {
  let sw = browser.targets().find((t) => t.type() === "service_worker");
  for (let i = 0; !sw && i < 20; i++) {
    await sleep(100);
    sw = browser.targets().find((t) => t.type() === "service_worker");
  }
  const id = new URL(sw.url()).host;
  const p = await browser.newPage();
  await p.goto(`chrome-extension://${id}/options-page/options.html`);
  await p.evaluate((v) => chrome.storage.sync.set(v), values);
  await p.close();
}

try {
  await setSettings({ "preview-on-hover-delay": 0.5 });

  // 1. Hover a cross-site link: preview opens after the delay.
  {
    const p = await freshPage();
    const c = await center(p, "#cross");
    await p.mouse.move(c.x, c.y, { steps: 5 });
    await sleep(1200);
    const url = await previewUrl(p);
    check(
      "hover opens cross-site preview",
      url?.includes("target-cross"),
      String(url),
    );

    // 2. Moving off the link (not into the preview) closes a hover-opened preview.
    const plain = await center(p, "#plain");
    await p.mouse.move(plain.x + 300, plain.y + 200, { steps: 5 });
    await sleep(1200);
    check("hovering away closes hover preview", (await previewUrl(p)) === null);
    await p.close();
  }

  // 2b. Moving into the preview keeps it open — even a fast jump that lands
  // straight on the iframe, where the page sees no further mousemoves — and
  // moving back out of it onto the page closes it.
  {
    const p = await freshPage();
    const c = await center(p, "#cross");
    await p.mouse.move(c.x, c.y, { steps: 5 });
    await sleep(1200);
    const body = await p.evaluate(() => {
      const r = document
        .querySelector("search-preview-window .wb-body")
        .getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await p.mouse.move(body.x, body.y, { steps: 1 });
    await sleep(1500);
    check(
      "fast move into preview keeps it open",
      (await previewUrl(p)) !== null,
    );
    await p.mouse.move(5, 880, { steps: 5 });
    await sleep(1500);
    check(
      "leaving the preview closes hover preview",
      (await previewUrl(p)) === null,
    );
    await p.close();
  }

  // 2c. Same, but the pointer crosses plain page on its way into the preview
  // (so it is already "off every link" before it gets there).
  {
    const p = await freshPage();
    const c = await center(p, "#cross");
    await p.mouse.move(c.x, c.y, { steps: 5 });
    await sleep(1200);
    const body = await p.evaluate(() => {
      const r = document
        .querySelector("search-preview-window .wb-body")
        .getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top };
    });
    await p.mouse.move(body.x, body.top - 30, { steps: 3 }); // above the panel, plain page
    await sleep(200);
    await p.mouse.move(body.x, body.y, { steps: 3 });
    await sleep(1500);
    check("detour into preview keeps it open", (await previewUrl(p)) !== null);
    await p.mouse.move(5, 880, { steps: 5 });
    await sleep(1500);
    check(
      "leaving preview after detour closes it",
      (await previewUrl(p)) === null,
    );
    await p.close();
  }

  // 3. A quick pass over a link must NOT open a preview.
  {
    const p = await freshPage();
    const c = await center(p, "#cross");
    await p.mouse.move(c.x, c.y, { steps: 2 });
    await sleep(150);
    await p.mouse.move(c.x + 400, c.y + 300, { steps: 2 });
    await sleep(1000);
    check(
      "brief pass over link does not preview",
      (await previewUrl(p)) === null,
    );
    await p.close();
  }

  // 4. Same-site link previews.
  {
    const p = await freshPage();
    const c = await center(p, "#same");
    await p.mouse.move(c.x, c.y, { steps: 5 });
    await sleep(1200);
    const url = await previewUrl(p);
    check(
      "hover opens same-site preview",
      url?.includes("target-same"),
      String(url),
    );
    await p.close();
  }

  // 5. Link rendered after load (SPA).
  {
    const p = await freshPage();
    await p.evaluate((port) => {
      const a = document.createElement("a");
      a.id = "late";
      a.href = `http://127.0.0.1:${port}/target-late`;
      a.textContent = "late link";
      document.getElementById("spa").appendChild(a);
    }, port);
    const c = await center(p, "#late");
    await p.mouse.move(c.x, c.y, { steps: 5 });
    await sleep(1200);
    check(
      "hover opens dynamically added link",
      (await previewUrl(p))?.includes("target-late"),
    );
    await p.close();
  }

  // Click triggers are tested with hover OFF so hover cannot mask them.
  await setSettings({ "preview-on-hover": false });

  // 6. Alt/Option + click previews and does not navigate.
  {
    const p = await freshPage();
    const c = await center(p, "#cross");
    await p.mouse.move(c.x, c.y);
    await p.keyboard.down("Alt");
    await p.mouse.click(c.x, c.y);
    await p.keyboard.up("Alt");
    await sleep(600);
    check(
      "alt+click previews without navigating",
      (await previewUrl(p))?.includes("target-cross") && p.url() === base,
    );
    await p.close();
  }

  // 7. Press-and-hold previews and does not navigate.
  {
    const p = await freshPage();
    const c = await center(p, "#cross");
    await p.mouse.move(c.x, c.y);
    await p.mouse.down();
    await sleep(700);
    await p.mouse.up();
    await sleep(500);
    check(
      "press-and-hold previews without navigating",
      (await previewUrl(p))?.includes("target-cross") && p.url() === base,
    );
    await p.close();
  }

  await setSettings({ "triple-click-preview": true });

  // 8. Triple-click previews and does not navigate.
  {
    const p = await freshPage();
    const c = await center(p, "#cross");
    await p.mouse.move(c.x, c.y);
    await p.mouse.click(c.x, c.y, { clickCount: 1 });
    await p.mouse.click(c.x, c.y, { clickCount: 2 });
    await p.mouse.click(c.x, c.y, { clickCount: 3 });
    await sleep(800);
    check(
      "triple-click previews without navigating",
      (await previewUrl(p))?.includes("target-cross") && p.url() === base,
      `url=${p.url()}`,
    );
    await p.close();
  }

  // 9. A normal single click still navigates (held ~300ms, then replayed).
  {
    const p = await freshPage();
    const c = await center(p, "#cross");
    await p.mouse.move(c.x, c.y);
    await Promise.all([
      p.waitForNavigation({ timeout: 3000 }).catch(() => null),
      p.mouse.click(c.x, c.y),
    ]);
    check(
      "single click still navigates",
      p.url().includes("target-cross"),
      p.url(),
    );
    await p.close();
  }
  // 10. A held click on a target=_blank link still opens its tab (the replay
  // must stay inside the real click's user activation or it is popup-blocked).
  {
    const p = await freshPage();
    const c = await center(p, "#blank");
    const opened = new Promise((r) =>
      browser.once("targetcreated", (t) => r(t.url())),
    );
    await p.mouse.click(c.x, c.y);
    const url = await Promise.race([opened, sleep(3000).then(() => null)]);
    check(
      "held click on target=_blank opens a tab",
      url?.includes("target-blank"),
      String(url),
    );
    await p.close();
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
