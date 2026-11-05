// A visible Chrome window, opened by the MARR server, in which an admin logs in to TimeMint's website
// by hand. MARR then reads pages in that window. Nothing about the login is stored: the window uses a
// temporary profile, so the login ends when the window closes.
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import type { FixHistoryTable } from "@/lib/fixHistory";

const SITE = "https://member.timemint.co/";
const TABLE_WAIT_MS = 15_000;
const IDLE_WAIT_MS = 10_000;

export class NotLoggedInError extends Error {}

interface WebSession {
  browser: Browser;
  context: BrowserContext;
}

// On globalThis so that hot reload in development doesn't lose track of the open window.
const store = globalThis as unknown as { marrTimeMintWeb?: WebSession | null };

export const isWindowOpen = () => !!store.marrTimeMintWeb?.browser.isConnected();

/** Opens the window on TimeMint's site, or brings the existing one to the front. */
export async function openWindow(): Promise<void> {
  if (isWindowOpen()) {
    const page = store.marrTimeMintWeb!.context.pages()[0] ?? (await store.marrTimeMintWeb!.context.newPage());
    await page.bringToFront();
    return;
  }
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  browser.on("disconnected", () => {
    store.marrTimeMintWeb = null;
  });
  const context = await browser.newContext({ viewport: null });
  store.marrTimeMintWeb = { browser, context };
  const page = await context.newPage();
  await page.goto(SITE, { waitUntil: "domcontentloaded" });
}

export async function closeWindow(): Promise<void> {
  await store.marrTimeMintWeb?.browser.close();
  store.marrTimeMintWeb = null;
}

// Runs in the page, written as text so the bundler can't add helpers the page doesn't have. A table
// without headers takes those of the table before it: some table plugins split the header off.
export const READ_TABLES = `(() => {
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const headingOf = (table) => {
    let node = table;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
        const text = clean(prev.innerText);
        if (text.startsWith("รายการ") && text.length < 60) return text;
      }
    }
    return null;
  };
  let lastHeaders = [];
  let lastSection = null;
  return [...document.querySelectorAll("table")].map((table) => {
    const headerRow = [...table.querySelectorAll("tr")].find((r) => [...r.querySelectorAll("th")].some((c) => clean(c.innerText)));
    if (headerRow) {
      lastHeaders = [...headerRow.children].map((c) => clean(c.innerText));
      lastSection = headingOf(table);
    }
    const rows = [...table.querySelectorAll("tr")]
      .filter((r) => r.querySelector("td"))
      .map((r) => [...r.children].map((c) => {
        const media = c.querySelector("img[src], a[href^='http']");
        return { text: clean(c.innerText), link: media ? media.src || media.href : null };
      }));
    return { section: lastSection, headers: lastHeaders, rows };
  });
})()`;

/**
 * Reads the time adjustment history page of one employee. Throws NotLoggedInError when TimeMint
 * sends the page elsewhere (no login, or the session expired).
 */
export async function readFixHistoryTables(empCode: string): Promise<FixHistoryTable[]> {
  const session = store.marrTimeMintWeb;
  if (!session || !session.browser.isConnected()) throw new NotLoggedInError("The TimeMint window is not open");

  const page = await session.context.newPage();
  try {
    await page.goto(`${SITE}viewfix.php?id=${encodeURIComponent(empCode)}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: IDLE_WAIT_MS }).catch(() => {});
    if (new URL(page.url()).pathname !== "/viewfix.php") {
      throw new NotLoggedInError("Not logged in to TimeMint in the opened window");
    }
    await page.waitForSelector("table", { state: "attached", timeout: TABLE_WAIT_MS }).catch(() => {});
    return (await page.evaluate(READ_TABLES)) as FixHistoryTable[];
  } finally {
    await page.close();
  }
}
