// Smoke test (§37): Edit dashboard drag in a real browser, with real mouse events, on the wide layout.
// Not part of the unit suites (vitest only runs *.test.* files under src/). It drives a running ByteSize:
//
//   1. A server with a throwaway database and an account, e.g.
//        createdb bytesize_walk                       (once)
//        cd frontend && npm run build && cd ../backend && npm run build
//        WEB_DIR=../frontend/dist PORT=4177 DATA_DIR=/tmp/walkdata JWT_SECRET=<32+ chars> \
//          DATABASE_URL=postgresql://bytesize:bytesize@localhost:5432/bytesize_walk node dist/index.js
//        then open http://localhost:4177 once and make the first account (alex / password123).
//   2. cd frontend && npm i --no-save puppeteer-core     (not a dependency: the Docker build doesn't need it)
//   3. node e2e/drag-smoke.mjs
//
// Settings (environment): BYTESIZE_URL (default http://localhost:4177), BYTESIZE_USER / BYTESIZE_PASSWORD
// (default alex / password123), CHROME (default /usr/bin/google-chrome). The person's saved layout is put back
// at the end. Exit code 0 = every check passed.
import puppeteer from "puppeteer-core";

const BASE = process.env.BYTESIZE_URL ?? "http://localhost:4177";
const USER = process.env.BYTESIZE_USER ?? "alex";
const PASSWORD = process.env.BYTESIZE_PASSWORD ?? "password123";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const failures = [];
function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `\n     expected ${JSON.stringify(expected)}\n     got      ${JSON.stringify(actual)}`}`);
  if (!ok) failures.push(what);
}

const { token } = await call("POST", "/api/auth/login", { username: USER, password: PASSWORD });
const saved = (await call("GET", "/api/dashboard/layout", undefined, token)).layout;
const DEFAULT = [["food"], ["budget", "water"], ["day-totals", "weight", "next-shot", "streak"]];
await call("PUT", "/api/dashboard/layout", { version: 1, columns: DEFAULT }, token);

const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const page = await browser.newPage();
try {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(BASE + "/");
  await page.evaluate((t) => localStorage.setItem("bytesize.token", t), token);
  await page.goto(BASE + "/#/");
  await page.reload();
  const clickText = (text) => page.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t)?.click(), text);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Edit dashboard") || b.textContent.includes("Start using")), { timeout: 15000 });
  // First-run prompts, if any
  for (const t of ["Start using ByteSize", "Not now"]) {
    if (await page.evaluate((x) => document.body.innerText.includes(x), t)) {
      await clickText(t);
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  // Edit dashboard waits for the saved layout to load; keep pressing it until edit mode opens
  for (let i = 0; i < 30 && !(await page.$('[data-testid="dashboard-column"] [data-widget]')); i++) {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Edit dashboard") && !b.disabled)?.click());
    await new Promise((r) => setTimeout(r, 300));
  }
  await page.waitForSelector('[data-testid="dashboard-column"] [data-widget]', { timeout: 5000 });

  const columns = () => page.$$eval('[data-testid="dashboard-column"]', (cols) => cols.map((c) => [...c.querySelectorAll("[data-widget]")].map((w) => w.getAttribute("data-widget"))));
  const centre = async (selector) => {
    const el = await page.$(selector);
    if (!el) throw new Error(`not on the page: ${selector}`);
    await el.scrollIntoView();
    const box = await el.boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, top: box.y, bottom: box.y + box.height, left: box.x, right: box.x + box.width };
  };
  // Press on a widget's handle, move in small steps to (x, y), check the drop line shows, let go
  async function drag(title, to, lineInColumn) {
    const handle = await centre(`button[aria-label="Drag ${title}"]`);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    const line = await page.$$eval('[data-testid="dashboard-column"]', (cols) => cols.findIndex((c) => c.querySelector('[data-testid="drop-line"]')));
    check(`drag ${title}: the drop line is in column ${lineInColumn + 1}`, line, lineInColumn);
    await page.mouse.up();
  }

  check("edit mode starts from the default", await columns(), DEFAULT);

  // Within a column: Streak (bottom of the right column) to the top of it, above Day totals
  const dayTotals = await centre('[data-widget="day-totals"]');
  await drag("Streak", { x: dayTotals.x, y: dayTotals.top + 5 }, 2);
  check("within a column: Streak moved to the top", await columns(), [["food"], ["budget", "water"], ["streak", "day-totals", "weight", "next-shot"]]);

  // Across columns: Water (middle) to the left column, under Food
  const food = await centre('[data-widget="food"]');
  await drag("Water", { x: food.x, y: food.bottom + 20 }, 0);
  check("across columns: Water under Food", await columns(), [["food", "water"], ["budget"], ["streak", "day-totals", "weight", "next-shot"]]);

  // Into an emptied column: Budget out of the middle, then Weight into the empty middle
  const left = await centre('[data-widget="water"]');
  await drag("Budget", { x: left.x, y: left.bottom + 20 }, 0);
  const middle = await centre('[data-testid="dashboard-column"]:nth-child(2)');
  await drag("Weight", { x: middle.x, y: middle.y }, 1);
  check("an empty column stays a drop target", await columns(), [["food", "water", "budget"], ["weight"], ["streak", "day-totals", "next-shot"]]);

  await clickText("Save");
  await page.waitForFunction(() => ![...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Save"), { timeout: 10000 });
  check("Save stored the dragged layout", (await call("GET", "/api/dashboard/layout", undefined, token)).layout?.columns, [["food", "water", "budget"], ["weight"], ["streak", "day-totals", "next-shot"]]);
} catch (e) {
  // What the page showed when it went wrong (SMOKE_SHOT=<file.png> to keep a picture of it)
  console.log((await page.evaluate(() => document.body.innerText).catch(() => "")).slice(0, 1500));
  if (process.env.SMOKE_SHOT) await page.screenshot({ path: process.env.SMOKE_SHOT }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  await call("PUT", "/api/dashboard/layout", saved ?? { version: 1, columns: DEFAULT }, token).catch(() => {});
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll drag checks passed");
process.exit(failures.length ? 1 : 0);
