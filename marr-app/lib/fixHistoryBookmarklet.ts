// A bookmark the admin clicks in their own browser, in a TimeMint tab opened from MARR's Settings page.
// It runs as TimeMint's site, so it can read the pages with the admin's own login; MARR never sees that
// login. It asks the Settings tab which employees to read and sends each page's tables back to it.

export const TIMEMINT_ORIGIN = "https://member.timemint.co";

/** Runs in TimeMint's tab. __MARR_ORIGIN__ limits who it talks to, in both directions. */
const SOURCE = `(async function () {
  var MARR = __MARR_ORIGIN__;
  if (window.__marrFixRunning) return;
  var box = document.createElement("div");
  box.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;max-width:360px;padding:14px 18px;background:#111827;color:#fff;font:14px sans-serif;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.4)";
  document.body.appendChild(box);
  var say = function (text) { box.textContent = text; };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var clean = function (s) { return (s || "").replace(/\\s+/g, " ").trim(); };
  var textOf = function (el) { return clean(el.innerText === undefined ? el.textContent : el.innerText); };

  function headingOf(table) {
    var node = table;
    for (var depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      for (var prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
        var text = textOf(prev);
        if (text.indexOf("รายการ") === 0 && text.length < 60) return text;
      }
    }
    return null;
  }

  /* A table without headers takes those of the table before it: some table plugins split the header off. */
  function readTables(doc) {
    var lastHeaders = [], lastSection = null;
    return Array.from(doc.querySelectorAll("table")).map(function (table) {
      var rows = Array.from(table.querySelectorAll("tr"));
      var headerRow = rows.find(function (r) {
        return Array.from(r.querySelectorAll("th")).some(function (c) { return textOf(c); });
      });
      if (headerRow) {
        lastHeaders = Array.from(headerRow.children).map(textOf);
        lastSection = headingOf(table);
      }
      return {
        section: lastSection,
        headers: lastHeaders,
        rows: rows.filter(function (r) { return r.querySelector("td"); }).map(function (r) {
          return Array.from(r.children).map(function (c) {
            var media = c.querySelector("img[src], a[href^='http']");
            return { text: textOf(c), link: media ? media.src || media.href : null };
          });
        })
      };
    });
  }

  function loadPage(empCode) {
    return new Promise(function (resolve, reject) {
      var frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;left:-20000px;top:0;width:1600px;height:1000px;border:0";
      var timer = setTimeout(function () { frame.remove(); reject(new Error("timeout")); }, 40000);
      frame.onload = async function () {
        try {
          if (frame.contentWindow.location.pathname !== "/viewfix.php") throw new Error("login");
          var doc = frame.contentDocument, last = -1, stable = 0;
          /* The page may fill its tables after loading: wait until the row count stops changing. */
          for (var i = 0; i < 60 && stable < 3; i++) {
            await sleep(500);
            var count = doc.querySelectorAll("table td").length;
            stable = count > 0 && count === last ? stable + 1 : 0;
            last = count;
          }
          resolve(readTables(doc));
        } catch (error) {
          reject(error);
        } finally {
          clearTimeout(timer);
          frame.remove();
        }
      };
      frame.src = "/viewfix.php?id=" + encodeURIComponent(empCode);
      document.body.appendChild(frame);
    });
  }

  var marr = window.opener;
  if (!marr) { say("MARR: เปิดแท็บนี้จากปุ่มในหน้า Settings ของ MARR ก่อน"); return; }
  window.__marrFixRunning = true;

  var employees = await new Promise(function (resolve) {
    var timer = setTimeout(function () { resolve(null); }, 5000);
    window.addEventListener("message", function listen(event) {
      if (event.origin !== MARR || event.source !== marr || !event.data || event.data.type !== "marr-fix-employees") return;
      clearTimeout(timer);
      window.removeEventListener("message", listen);
      resolve(event.data.employees);
    });
    say("MARR: กำลังติดต่อหน้า Settings...");
    marr.postMessage({ type: "marr-fix-ready" }, MARR);
  });

  try {
    if (!employees) { say("MARR: ติดต่อหน้า Settings ไม่ได้ เปิดแท็บนี้จากปุ่มในหน้า Settings แล้วลองใหม่"); return; }
    if (employees.length === 0) { say("MARR: ยังไม่ได้เลือกพนักงานในหน้า Settings"); return; }
    for (var n = 0; n < employees.length; n++) {
      var emp = employees[n];
      say("MARR: กำลังอ่าน " + (n + 1) + "/" + employees.length + " " + emp.name);
      try {
        var tables = await loadPage(emp.emp_code);
        marr.postMessage({ type: "marr-fix-page", employee_id: emp.id, tables: tables }, MARR);
      } catch (error) {
        if (error && error.message === "login") {
          marr.postMessage({ type: "marr-fix-error", message: "Not logged in to TimeMint" }, MARR);
          say("MARR: ยังไม่ได้ login TimeMint กรุณา login แล้วกดอีกครั้ง");
          return;
        }
        marr.postMessage({ type: "marr-fix-page", employee_id: emp.id, tables: null }, MARR);
      }
      await sleep(1000);
    }
    marr.postMessage({ type: "marr-fix-done" }, MARR);
    say("MARR: อ่านครบแล้ว กลับไปดูผลที่หน้า Settings");
  } finally {
    window.__marrFixRunning = false;
  }
})();`;

/** The javascript: address of the bookmark, tied to this MARR server's address. */
export function buildBookmarklet(marrOrigin: string): string {
  return `javascript:${encodeURIComponent(SOURCE.replace("__MARR_ORIGIN__", JSON.stringify(marrOrigin)))}`;
}
