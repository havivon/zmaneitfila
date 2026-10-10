#!/usr/bin/env node
/* ======================================================================
   חבילת בדיקות קצה-לקצה ללוח זמני התפילות.
   מריצה את android/prepare-assets.sh, טוענת את גרסת ה-assets (שכל התלויות
   בה מקומיות) דרך file://, ובודקת את דרישות בעל הפרויקט ואת רשימת
   "בדיקה לפני מסירה" שב-AGENTS.md.

   הרצה:   node tests/e2e.mjs            — כל הבדיקות
           node tests/e2e.mjs export drag — רק בדיקות שהמזהה שלהן מכיל מחרוזת
   משתני סביבה: CHROMIUM_PATH — נתיב לכרום (ברירת מחדל ‎/opt/pw-browsers/...)
                SKIP_PREPARE=1 — לא להריץ את prepare-assets.sh
   תוצרים חזותיים נשמרים ב-tests/out/ (מוחרג מ-git).
   ====================================================================== */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'out');
const SRC = path.join(ROOT, 'index.html');
const ASSET = path.join(ROOT, 'android/app/src/main/assets/index.html');
/* QA_PAGE — נתיב לקובץ HTML אחר (למשל גרסה קודמת להשוואה); ברירת מחדל: קובץ ה-assets */
const PAGE_URL = pathToFileURL(process.env.QA_PAGE ? path.resolve(process.env.QA_PAGE) : ASSET).href;
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const QA_LIB = fs.readFileSync(path.join(HERE, 'qa-lib.js'), 'utf8');
const STORE = 'zmanei-tfila-yechezkel-v2';
const KEYSTORE_SHA256 = 'ac78342c0c7ff8f73d1b171e4061be5bad883ca1dbd716dc0cce0ae12c2a6a47';
const FILTERS = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });

/* ---------------------------------------------------------------- הכנה */
const assetBefore = fs.existsSync(ASSET) ? fs.readFileSync(ASSET, 'utf8') : null;
let assetPrepared = false;
if (!process.env.SKIP_PREPARE) {
  execFileSync(path.join(ROOT, 'android/prepare-assets.sh'), { stdio: 'inherit' });
  assetPrepared = true;
}
const assetAfter = fs.readFileSync(ASSET, 'utf8');

/* ---------------------------------------------------------------- מסגרת */
const tests = [];
const test = (id, title, reqs, fn, opts = {}) => tests.push({ id, title, reqs, fn, opts });
class Warn extends Error {}
const fail = (msg) => { throw new Error(msg); };
const check = (cond, msg) => { if (!cond) fail(msg); };
const warn = (msg) => { throw new Warn(msg); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const r1 = (n) => Math.round(n * 10) / 10;

let browser;
let cur;                         /* הקשר הבדיקה הנוכחית */
const suiteDialogs = [];         /* כל קריאות alert/confirm/prompt בכל החבילה */

/* דף חדש בהקשר חדש — localStorage ריק, אלא אם הועבר seed */
async function open(o = {}) {
  const mobile = !!o.mobile;
  const ctx = await browser.newContext({
    viewport: o.viewport || (mobile ? { width: 390, height: 844 } : { width: 1400, height: 1800 }),
    deviceScaleFactor: o.dpr || 1,
    isMobile: mobile,
    hasTouch: mobile || !!o.touch,
    acceptDownloads: true,
    locale: 'he-IL',
    timezoneId: o.tz || 'Asia/Jerusalem'
  });
  cur.contexts.push(ctx);
  /* כלל 3: אסור שום משאב חיצוני. כל בקשת רשת נחסמת ונרשמת. */
  await ctx.route(/^(https?|wss?):/, (route) => {
    cur.requests.push(route.request().url());
    return route.abort();
  });
  await ctx.addInitScript(QA_LIB);
  if (o.seed !== undefined) {
    await ctx.addInitScript(([key, val]) => {
      if (!sessionStorage.getItem('__qa_seeded')) {
        localStorage.setItem(key, val);
        sessionStorage.setItem('__qa_seeded', '1');
      }
    }, [STORE, typeof o.seed === 'string' ? o.seed : JSON.stringify(o.seed)]);
  }
  for (const s of (o.init || [])) await ctx.addInitScript(s);
  const page = await ctx.newPage();
  cur.pages.push(page);
  page.on('pageerror', e => cur.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') cur.errors.push('console.error: ' + m.text()); });
  page.on('dialog', d => { cur.dialogs.push('native ' + d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });
  if (o.clock) await page.clock.setFixedTime(o.clock);
  if (o.goto !== false) await load(page);
  return page;
}
async function load(page, reload = false) {
  if (reload) await page.reload(); else await page.goto(PAGE_URL);
  await waitReady(page);
}
async function waitReady(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('[x-data]');
    return el && el._x_dataStack && !el.hasAttribute('x-cloak') && document.fonts.status === 'loaded';
  }, null, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(650);                         /* אנימציית fade-up של המעטפת */
}
const app = (page, fn, arg) => page.evaluate(fn, arg);

async function tapEl(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  check(b, 'אין תיבה לאלמנט שצריך ללחוץ עליו');
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  return b;
}
async function center(locator) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}
/* מגע אמיתי דרך CDP: לחיצה, החזקה, תזוזה, שחרור */
async function touchDrag(page, from, to, { hold = 450, steps = 14, stepMs = 16, during } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  await sleep(hold);
  if (during) await during('held');
  for (let i = 1; i <= steps; i++) {
    const x = from.x + (to.x - from.x) * i / steps, y = from.y + (to.y - from.y) * i / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await sleep(stepMs);
  }
  if (during) await during('moved');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
async function mouseDrag(page, from, to, { hold = 450, steps = 14 } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await sleep(hold);
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}
const labels = (page, si) => app(page, (si) => __qa.app().d.sections[si].items.map(i => i.label), si);

/* מייצא את הלוח ושומר את הקנבס ב-window.__qaCanvas */
async function exportCanvas(page) {
  return app(page, async () => {
    const t0 = performance.now();
    const c = await __qa.app().renderCanvas();
    window.__qaCanvas = c;
    const p = document.getElementById('poster');
    return { w: c.width, h: c.height, ms: Math.round(performance.now() - t0), pw: p.offsetWidth, ph: parseFloat(getComputedStyle(p).height) };
  });
}
async function saveCanvas(page, name) {
  const url = await app(page, () => window.__qaCanvas.toDataURL('image/png'));
  const f = path.join(OUT, name);
  fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
  return path.relative(ROOT, f);
}
function saveDataUrl(url, name) {
  const f = path.join(OUT, name);
  fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
  return path.relative(ROOT, f);
}
/* צילום הלוח החי (DOM) — בעמוד ב-DPR 1.5 זה באותה רזולוציה כמו הייצוא */
async function posterShot(page) {
  const r = await page.locator('#poster').boundingBox();
  const buf = await page.screenshot({ clip: { x: r.x, y: r.y, width: r.width, height: r.height }, caret: 'hide' });
  return 'data:image/png;base64,' + buf.toString('base64');
}
const setData = (page, patch) => app(page, (p) => {
  const d = __qa.app().d;
  for (const [k, v] of Object.entries(p)) d[k] = v;
}, patch);
const settle = (ms = 400) => sleep(ms);

/* ======================================================================
   בדיקות
   ====================================================================== */

/* ---------- טעינה ותשתית ---------- */
test('load.clean', 'העמוד נטען, Alpine אותחל, אין שגיאות קונסול ואין בקשות רשת', ['AGENTS:בדיקה', 'R20', 'כלל 3'], async () => {
  const page = await open();
  const st = await app(page, () => ({
    title: document.querySelector('#poster .p-title').textContent,
    rows: document.querySelectorAll('#poster .p-row').length,
    panelVisible: document.querySelector('.panel').offsetHeight > 0,
    cloak: document.body.hasAttribute('x-cloak'),
    key: Object.keys(localStorage)
  }));
  check(!st.cloak && st.panelVisible, 'המסך ריק — Alpine לא אותחל');
  check(st.title.trim().length > 0, 'שם בית הכנסת לא מוצג בלוח');
  check(st.rows >= 5, 'מעט מדי שורות זמנים בלוח: ' + st.rows);
  await sleep(2200);                         /* כולל הכנת התמונה ברקע */
  check(cur.requests.length === 0, 'בקשות רשת: ' + cur.requests.join(', '));
  return `שורות בלוח: ${st.rows}`;
});

test('static.asset-sync', 'קובץ ה-assets שבמאגר תואם ל-index.html (prepare-assets הורץ)', ['כלל 1'], async () => {
  check(assetPrepared, 'prepare-assets לא הורץ (SKIP_PREPARE) — אי אפשר לבדוק');
  check(assetBefore === assetAfter, 'android/app/src/main/assets/index.html לא היה מעודכן לפני ההרצה — שכחו להריץ prepare-assets.sh');
});

test('static.external', 'index.html: אין משאבים חיצוניים מלבד שורות הטעינה המותרות', ['כלל 2', 'כלל 3'], async () => {
  const src = fs.readFileSync(SRC, 'utf8');
  const allowed = [
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/alpinejs/3.13.3/cdn.min.js',
    'https://fonts.googleapis.com', 'https://fonts.gstatic.com',
    'https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@400;500;700;900&family=Heebo:wght@300;400;500;700;900&display=swap',
    'https://web.whatsapp.com/'
  ];
  const urls = [...new Set((src.match(/https?:\/\/[^\s"'`)<>]+/g) || []))];
  const bad = urls.filter(u => !allowed.includes(u) && !/^http:\/\/www\.w3\.org\//.test(u));
  check(bad.length === 0, 'כתובות חיצוניות לא מוכרות: ' + bad.join(', '));
  /* שורות הטעינה חייבות להישאר בדיוק כפי ש-prepare-assets מצפה */
  for (const line of ['<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>',
    '<script defer src="https://cdnjs.cloudflare.com/ajax/libs/alpinejs/3.13.3/cdn.min.js"></script>',
    '<link rel="preconnect" href="https://fonts.googleapis.com">', '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'])
    check(src.includes(line), 'שורת טעינה השתנתה: ' + line);
  const asset = fs.readFileSync(ASSET, 'utf8');
  const extAsset = (asset.match(/(src|href)="https?:[^"]+"/g) || []);
  check(extAsset.length === 0, 'בקובץ ה-assets נשארו src/href חיצוניים: ' + extAsset.join(', '));
  return 'כתובות שנמצאו: ' + urls.length;
});

test('static.keystore', 'מפתח החתימה ותצורת החתימה לא שונו', ['R22'], async () => {
  const ks = path.join(ROOT, 'android/keystore/zmanei-tfila.jks');
  const h = crypto.createHash('sha256').update(fs.readFileSync(ks)).digest('hex');
  check(h === KEYSTORE_SHA256, 'קובץ המפתח השתנה! sha256=' + h);
  const g = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  check(/storeFile\s*=\s*rootProject\.file\("keystore\/zmanei-tfila\.jks"\)/.test(g), 'storeFile בתצורת החתימה השתנה');
  check((g.match(/signingConfig\s*=\s*signingConfigs\.getByName\("shared"\)/g) || []).length >= 2, 'release/debug אינם חתומים במפתח המשותף');
  check(/versionCode\s*=\s*\(project\.findProperty\("appVersionCode"\)/.test(g), 'versionCode אינו נלקח מ-appVersionCode');
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/android.yml'), 'utf8');
  check(/-PappVersionCode=\$\{\{\s*github\.run_number\s*\}\}/.test(wf), 'ה-workflow אינו מעביר versionCode עולה (run_number)');
});

test('static.html2canvas-css', 'עיצוב הלוח אינו משתמש בתכונות CSS ש-html2canvas אינו תומך בהן', ['כלל 4', 'R7'], async () => {
  const page = await open();
  const bad = await app(page, () => {
    const poster = document.getElementById('poster');
    const els = [poster, ...poster.querySelectorAll('*')];
    const out = [];
    /* 1. כללי CSS שחלים על הלוח או על צאצאיו (כולל ::before/::after) */
    const forbid = [/(^|[^-])box-shadow\s*:/, /(^|[^-])filter\s*:/, /backdrop-filter\s*:/, /(^|[^-])mask(-image)?\s*:/,
      /clip-path\s*:/, /background-clip\s*:\s*text/, /repeating-(linear|radial)-gradient/, /translate3d|rotate[XY3]|perspective|matrix3d|scale3d|translateZ/];
    for (const sh of document.styleSheets) {
      let rules; try { rules = sh.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        if (!r.selectorText) continue;
        const sel = r.selectorText.replace(/::?(before|after)/g, '');
        let hits = false;
        try { hits = els.some(e => e.matches(sel)); } catch (e) { continue; }
        if (!hits) continue;
        const txt = r.style.cssText;
        for (const f of forbid) if (f.test(txt)) out.push(r.selectorText + ' → ' + txt.match(f)[0]);
      }
    }
    /* 2. ערכים מחושבים בפועל */
    for (const e of els) for (const pse of [null, '::before', '::after']) {
      const cs = getComputedStyle(e, pse);
      const name = (e.className || e.id || e.tagName) + (pse || '');
      if (cs.boxShadow !== 'none') out.push(name + ' box-shadow');
      if (cs.filter !== 'none') out.push(name + ' filter');
      if (cs.backdropFilter && cs.backdropFilter !== 'none') out.push(name + ' backdrop-filter');
      if (cs.clipPath !== 'none') out.push(name + ' clip-path');
      if ((cs.maskImage || cs.webkitMaskImage || 'none') !== 'none') out.push(name + ' mask');
      if (/repeating-/.test(cs.backgroundImage)) out.push(name + ' repeating-gradient');
      if (/matrix3d/.test(cs.transform)) out.push(name + ' 3d transform');
    }
    return [...new Set(out)];
  });
  check(bad.length === 0, bad.join(' | '));
});

test('static.no-native-dialog-code', 'אין alert/confirm/prompt בקוד; askThen קיים; מבנה האנדרואיד שלם', ['כלל 5', 'כלל 6', 'R12'], async () => {
  const src = fs.readFileSync(SRC, 'utf8');
  const script = src.slice(src.indexOf('<script>'));
  const hits = script.match(/(^|[^.\w$])(alert|confirm|prompt)\s*\(/gm) || [];
  check(hits.length === 0, 'קריאות לחלונות מערכת בקוד: ' + hits.join(', '));
  check(/askThen\s*\(title, text, ok, run\)/.test(src), 'askThen חסר');
  for (const s of ['window.AndroidBridge', 'window.__update', 'window.__closeTopLayer', `'${STORE}'`])
    check(src.includes(s), 'חסר בקוד: ' + s);
  const page = await open();
  const st = await app(page, () => ({ u: typeof window.__update, c: typeof window.__closeTopLayer }));
  check(st.u === 'function' && st.c === 'function', '__update/__closeTopLayer אינם פונקציות בזמן ריצה');
});

/* ---------- ייצוא ---------- */
test('export.basic', 'ייצוא: 1080 ברוחב, גבוה כמסך טלפון, מהיר, בלי חיתוך ובלי שוליים', ['R6', 'AGENTS:בדיקה'], async () => {
  const page = await open({ dpr: 1.5 });
  const e = await exportCanvas(page);
  const file = await saveCanvas(page, 'export-default.png');
  check(e.w === 1080, 'רוחב הייצוא ' + e.w + ' (צריך 1080)');
  check(e.h >= e.w * 1.7, `הייצוא נמוך מדי למסך טלפון: ${e.w}×${e.h} (יחס ${r1(e.h / e.w)})`);
  check(Math.abs(e.h - e.ph * 1.5) <= 1, `גובה הייצוא ${e.h} אינו גובה הלוח ×1.5 (${e.ph * 1.5}) — הלוח נחתך או נמתח`);
  check(e.ms < 8000, 'הייצוא איטי מדי: ' + e.ms + ' ms');
  const st = await app(page, () => {
    const c = window.__qaCanvas, img = __qa.canvasData(c), poster = document.getElementById('poster');
    const foot = [...poster.querySelectorAll('.p-blessing,.p-ded,.p-addr,.p-foot-orn')].filter(x => x.offsetParent);
    const bottom = Math.max(...foot.map(x => { const r = __qa.relRect(x); return r.y + r.h; }));
    const bl = poster.querySelector('.p-blessing'), r = __qa.relRect(bl);
    const ink = __qa.ink(__qa.crop(img, r.x * 1.5, r.y * 1.5, r.w * 1.5, r.h * 1.5));
    /* שולי התמונה: צבע המסגרת, לא שקוף/לבן (letterbox) */
    const edges = [[c.width / 2, 2], [c.width / 2, c.height - 3], [2, c.height / 2], [c.width - 3, c.height / 2]].map(([x, y]) => __qa.px(img, x, y));
    return { bottom, blessInk: ink.inkW / (r.w * 1.5), edges };
  });
  check(st.bottom * 1.5 <= e.h - 10, `תוכן תחתון (${r1(st.bottom * 1.5)}px) חורג מגובה התמונה ${e.h}`);
  check(st.blessInk > 0.3, 'ברכת הסיום אינה מופיעה בתמונה (דיו ' + r1(st.blessInk) + ')');
  for (const p of st.edges) {
    check(p[3] === 255, 'פיקסל שקוף בשולי התמונה: ' + p);
    check(p[0] + p[1] + p[2] < 450, 'שוליים בהירים (letterbox?) בשולי התמונה: ' + p);
  }
  return `${e.w}×${e.h} (יחס ${r1(e.h / e.w)}), ${e.ms} ms → ${file}`;
});

test('export.tall-content', 'ייצוא עם תוכן רב: הלוח גדל והכתובת שבתחתית לא נחתכת', ['R6'], async () => {
  const page = await open({ dpr: 1.5, viewport: { width: 1400, height: 3400 } });
  await app(page, () => {
    const d = __qa.app().d;
    for (let i = 0; i < 8; i++) d.sections[1].items.push({ id: 'x' + i, label: 'שיעור נוסף ' + (i + 1), time: '2' + (i % 4) + ':00', note: '', enabled: true, freeText: false });
    d.notes = 'שורה ראשונה\nשורה שנייה\nשורה שלישית\nשורה רביעית\nשורה חמישית\nשורה שישית';
    d.dedication = 'לעילוי נשמת פלוני בן פלוני';
    d.address = 'רחוב הבדיקה 1, עיר';
    d.banner = 'הודעה מודגשת לבדיקה';
  });
  await settle(600);
  const e = await exportCanvas(page);
  const file = await saveCanvas(page, 'export-tall.png');
  check(Math.abs(e.h - e.ph * 1.5) <= 1, `גובה הייצוא ${e.h} ≠ גובה הלוח ×1.5 (${e.ph * 1.5})`);
  const st = await app(page, () => {
    const img = __qa.canvasData(window.__qaCanvas);
    const a = document.querySelector('#poster .p-addr'), r = __qa.relRect(a);
    const ink = __qa.ink(__qa.crop(img, r.x * 1.5, r.y * 1.5, r.w * 1.5, r.h * 1.5), 100);
    return { addrBottom: (r.y + r.h) * 1.5, ink: ink.inkW, vis: a.offsetParent !== null };
  });
  check(st.vis, 'הכתובת אינה מוצגת בלוח');
  check(st.addrBottom <= e.h, `הכתובת (${r1(st.addrBottom)}) מחוץ לתמונה (${e.h})`);
  check(st.ink > 40, 'הכתובת אינה מצוירת בתמונה');
  return `${e.w}×${e.h} (לוח ${e.pw}×${e.ph}), ${e.ms} ms → ${file}`;
});

test('export.scrolled', 'ייצוא כשהעמוד גלול (טלפון, עריכה בתחתית) זהה לייצוא בראש העמוד', ['R6', 'R7'], async () => {
  const page = await open({ mobile: true });
  await exportCanvas(page);
  await app(page, () => { window.__qaA = __qa.canvasData(window.__qaCanvas); });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await settle(300);
  const sy = await page.evaluate(() => scrollY);
  check(sy > 500, 'העמוד לא נגלל (scrollY=' + sy + ')');
  const e = await exportCanvas(page);
  const file = await saveCanvas(page, 'export-scrolled.png');
  const d = await app(page, () => __qa.diff(window.__qaA, __qa.canvasData(window.__qaCanvas)));
  check(d.mean < 1, `הייצוא בעמוד גלול שונה מהייצוא הרגיל: הפרש ממוצע ${r1(d.mean)}, ${r1(d.frac * 100)}% פיקסלים → ${file}`);
  return `scrollY=${sy}, הפרש ${r1(d.mean)} (${e.w}×${e.h})`;
});

test('export.device-independent', 'הייצוא בטלפון (390px) זהה לייצוא במחשב', ['R6', 'R7'], async () => {
  const desk = await open({ dpr: 1.5 });
  await exportCanvas(desk);
  const a = await app(desk, () => window.__qaCanvas.toDataURL('image/png'));
  const mob = await open({ mobile: true, dpr: 3 });
  const e = await exportCanvas(mob);
  const file = await saveCanvas(mob, 'export-mobile.png');
  const d = await app(mob, async (a) => {
    const A = await __qa.imgData(a), B = __qa.canvasData(window.__qaCanvas);
    return { ...__qa.diff(A, B), aw: A.w, ah: A.h };
  }, a);
  check(d.aw === e.w && d.ah === e.h, `מידות שונות: מחשב ${d.aw}×${d.ah}, טלפון ${e.w}×${e.h}`);
  check(d.mean < 2, `הייצוא בטלפון שונה מהייצוא במחשב: הפרש ממוצע ${r1(d.mean)} → ${file}`);
  return `הפרש ממוצע ${r1(d.mean)}`;
});

test('export.time-glyphs', 'נאמנות הייצוא: השעות (למשל 18:20) מצוירות בתמונה כמו בלוח החי, בלי רווח לפני הנקודתיים', ['R7', 'כלל 4'], async () => {
  const page = await open({ dpr: 1.5 });
  await exportCanvas(page);
  await saveCanvas(page, 'export-times.png');
  const els = await app(page, () => [...document.querySelectorAll('#poster .p-time')]
    .filter(e => e.offsetParent && /^\d{1,2}:\d{2}$/.test(e.textContent.trim()))
    .map((e, i) => { e.dataset.qa = 't' + i; const b = e.getBoundingClientRect(); return { i, text: e.textContent.trim(), rel: __qa.relRect(e), abs: { x: b.left, y: b.top, w: b.width, h: b.height }, fs: parseFloat(getComputedStyle(e).fontSize) }; }));
  check(els.length >= 5, 'מעט מדי שעות בלוח: ' + els.length);
  const rows = [];
  const crops = [];
  for (const t of els) {
    const buf = await page.screenshot({ clip: { x: t.abs.x, y: t.abs.y, width: t.abs.w, height: t.abs.h } });
    const res = await app(page, async ([shot, t]) => {
      const dom = await __qa.imgData(shot);
      const exp = __qa.crop(__qa.canvasData(window.__qaCanvas), t.rel.x * 1.5, t.rel.y * 1.5, t.rel.w * 1.5, t.rel.h * 1.5);
      const a = __qa.ink(dom), b = __qa.ink(exp);
      return { dom: a, exp: b, domPng: __qa.toPng(dom), expPng: __qa.toPng(exp) };
    }, ['data:image/png;base64,' + buf.toString('base64'), t]);
    rows.push({ t, ...res });
    if (crops.length < 3) crops.push(saveDataUrl(res.domPng, `time-${t.i}-live.png`), saveDataUrl(res.expPng, `time-${t.i}-export.png`));
  }
  const bad = [];
  const lines = [];
  for (const r of rows) {
    const fpx = r.t.fs * 1.5;                  /* גודל הגופן בפיקסלים של התמונה */
    check(r.dom.inkW > r.t.rel.w * 0.5 && r.exp.inkW > 0, `לא נמצא דיו לשעה ${r.t.text} — הבדיקה אינה תקפה`);
    const gapDelta = r.exp.maxGap - r.dom.maxGap;
    const widthDelta = (r.exp.inkW - r.dom.inkW) / r.dom.inkW;
    lines.push(`${r.t.text}: רווח מרבי חי ${r.dom.maxGap}px / ייצוא ${r.exp.maxGap}px, רוחב דיו ${r.dom.inkW}/${r.exp.inkW}px`);
    /* סף: רווח עודף של יותר מ-6% מגובה הגופן (≈3.6px ב-60px) נראה לעין כ"18 :20" */
    if (gapDelta > Math.max(3, fpx * 0.06) || Math.abs(widthDelta) > 0.06)
      bad.push(`${r.t.text} (רווח +${gapDelta}px, רוחב ${r1(widthDelta * 100)}%)`);
  }
  check(bad.length === 0, 'שעות שמצוירות אחרת בייצוא: ' + bad.join('; ') + ' | ' + lines.slice(0, 3).join(' | ') + ' | חיתוכים: ' + crops.join(', '));
  return lines.slice(0, 3).join(' | ');
});

/* קישוטים: הייצוא צריך להיות קרוב ללוח החי הרבה יותר מאשר ללוח שהקישוט הוסר ממנו */
test('export.ornaments', 'נאמנות הייצוא: כל העיטורים (מגן דוד, פינות, כתר, קשת, מפרידים, דיוקן) מופיעים בתמונה', ['R1', 'R7', 'AGENTS:בדיקה'], async () => {
  const page = await open({ dpr: 1.5 });
  await setData(page, { banner: 'הודעה מודגשת לבדיקה', notes: 'הודעה לבדיקה', address: 'רחוב הבדיקה 1' });
  await settle(600);
  await exportCanvas(page);
  const A = await posterShot(page);
  await app(page, async (A) => { window.__qaA = await __qa.imgData(A); window.__qaE = __qa.canvasData(window.__qaCanvas); }, A);
  const whole = await app(page, () => ({ ...__qa.diff(window.__qaA, window.__qaE), png: __qa.diffPng(window.__qaA, window.__qaE) }));
  const diffFile = saveDataUrl(whole.png, 'fidelity-diff.png');
  saveDataUrl(A, 'fidelity-live.png');
  const items = [
    ['מגן דוד', '.p-star'], ['פינה ימנית עליונה', '.p-corner.tr'], ['פינה שמאלית עליונה', '.p-corner.tl'],
    ['פינה ימנית תחתונה', '.p-corner.br'], ['פינה שמאלית תחתונה', '.p-corner.bl'], ['כתר', '.p-crown'],
    ['עיטור כותרת משנה (ימין)', '.p-sub i:not(.flip)'], ['עיטור כותרת משנה (שמאל, הפוך)', '.p-sub i.flip'],
    ['מעויין בשורת המטא', '.p-meta b'], ['קו בכותרת קבוצה', '.p-card-head i'], ['מעויין בכותרת קבוצה', '.p-card-head b'],
    ['נקודות מוליכות', '.p-dots'], ['קו מפריד בין שורות', '.p-row', '.p-row{border-bottom-color:transparent!important}', 'bottomEdge'],
    ['רצועת זהב', '.p-banner'], ['כותרת ההודעות', '.p-notes-head i'], ['עיטור תחתון', '.p-foot-orn'], ['דיוקן', '.p-portrait-frame'],
    ['מסגרת זהב כפולה חיצונית', '.poster', '.poster::before,.poster::after{display:none!important}', 'leftStrip'],
    ['קשת — קו חיצוני', '.poster-frame', '.poster-frame{border-color:transparent!important}', 'archTop'],
    ['קשת — קו פנימי', '.poster-frame', '.poster-frame::before{display:none!important}', 'archTop'],
    ['שם בית הכנסת', '.p-title'], ['ברכת הסיום', '.p-blessing']
  ];
  const res = [];
  for (const [name, sel, css, mode] of items) {
    const rect = await app(page, ([sel, mode]) => {
      const el = [...document.querySelectorAll('#poster ' + sel)].find(x => x.getClientRects().length) || (sel === '.poster' ? document.getElementById('poster') : null);
      if (!el || !el.getClientRects().length) return null;
      let r = __qa.relRect(el);
      if (mode === 'leftStrip') r = { x: 0, y: 300, w: 30, h: 800 };
      if (mode === 'archTop') r = { x: r.x, y: r.y, w: r.w, h: 200 };
      if (mode === 'bottomEdge') r = { x: r.x, y: r.y + r.h - 3, w: r.w, h: 6 };
      /* קו דק מ-2.5px: ההחלקה (anti-aliasing) מפזרת אותו אחרת בין שורות הפיקסלים */
      const thin = !mode && el.getBoundingClientRect().height < 2.5;
      return { x: Math.floor(r.x - 3), y: Math.floor(r.y - 3), w: Math.ceil(r.w + 6), h: Math.ceil(r.h + 6), thin };
    }, [sel, mode]);
    if (!rect) { res.push({ name, err: 'לא נמצא בלוח' }); continue; }
    const id = await page.addStyleTag({ content: css || ('#poster ' + sel + '{visibility:hidden!important}') });
    await sleep(60);
    const B = await posterShot(page);
    await id.evaluate(n => n.remove());
    const m = await app(page, async ([B, r]) => {
      const Bi = await __qa.imgData(B);
      const c = (img) => __qa.crop(img, r.x * 1.5, r.y * 1.5, r.w * 1.5, r.h * 1.5);
      const a = c(window.__qaA), b = c(Bi), e = c(window.__qaE);
      /* ביקורת: "ייצוא" שחסר בו הקישוט (b עצמו) חייב לקבל ציון נמוך באותה סבולת היסט,
         אחרת המדד אינו מבחין. סבולת 0, ואם אינה מספיקה — ±1px ואז ±2px (קווי שערה שזזים
         בתת-פיקסל נתנו בסבולת ±1 תוצאה לא יציבה: 50% או 100% לסירוגין). */
      const tries = [0, 1, 2].map(R => ({ R, ...__qa.presence(a, b, e, 40, R), control: __qa.presence(a, b, b, 40, R).score }));
      const ok = tries.find(t => t.score >= 0.75 && t.control <= 0.2);
      /* בקו דק משווים את כמות הדיו בעמודה (סכום על פני גובה הקו) בשש נקודות לאורכו:
         הקו קיים ובאותו פרופיל דהייה, גם אם ההחלקה פיזרה אותו אחרת בין השורות */
      let along = null;
      if (r.thin) {
        const bg = __qa.bgOf(b);
        const col = (I, f) => { const x = Math.round(f * (I.w - 1)); let s = 0; for (let y = 0; y < I.h; y++) { const i = (y * I.w + x) * 4; s += Math.abs(I.data[i] - bg[0]) + Math.abs(I.data[i + 1] - bg[1]) + Math.abs(I.data[i + 2] - bg[2]); } return s; };
        const fs_ = [0.05, 0.15, 0.3, 0.5, 0.7, 0.9];
        along = fs_.map(f => ({ live: col(a, f), exp: col(e, f), without: col(b, f) }));
      }
      return { ...(ok || tries[0]), valid: tries.some(t => t.control <= 0.2), along, png: __qa.side([a, e], 2) };
    }, [B, rect]);
    const idx = res.length;
    m.file = saveDataUrl(m.png, `ornament-${String(idx).padStart(2, '0')}.png`); delete m.png;
    res.push({ name, ...m });
  }
  const bad = [];
  for (const r of res) {
    if (r.err) { bad.push(r.name + ': ' + r.err); continue; }
    if (r.mask < 30) { bad.push(`${r.name}: הקישוט כמעט אינו נראה בלוח החי (${r.mask} פיקסלים — בדיקה לא תקפה)`); continue; }
    if (!r.valid) { bad.push(`${r.name}: המדד אינו מבחין בקישוט חסר (ביקורת ${r1(r.control)}) — בדיקה לא תקפה`); continue; }
    /* קו דק: בכל נקודה שבה הקו נראה בלוח החי, יש בייצוא לפחות 30% מכמות הדיו (ולא פי 3 יותר).
       זו בדיקת נוכחות ופרופיל דהייה, לא של עובי: עוצמת קווי 1.5px בייצוא משתנה בין טעינות
       (40%–80% מהחי) בגלל ייצוא לא דטרמיניסטי — ראו export.deterministic. */
    if (r.along) {
      const pts = r.along.filter(p => p.live - p.without > 60);
      r.alongRatios = pts.map(p => r1((p.exp - p.without) / (p.live - p.without)));
      const off = r.alongRatios.filter(q => q < 0.3 || q > 3);
      if (pts.length >= 2 && off.length === 0) { r.by = 'ink-along-line'; continue; }
      bad.push(`${r.name}: קו דק — יחסי דיו ייצוא/חי לאורך הקו ${r.alongRatios.join(',')} (חי | ייצוא: ${r.file})`);
      continue;
    }
    /* רוב פיקסלי הקישוט צריכים להופיע גם בתמונה המיוצאת */
    if (r.score < 0.75) bad.push(`${r.name}: רק ${Math.round(r.score * 100)}% מפיקסלי הקישוט מופיעים בייצוא (חי | ייצוא: ${r.file})`);
  }
  fs.writeFileSync(path.join(OUT, 'fidelity.json'), JSON.stringify({ whole: { mean: whole.mean, frac: whole.frac }, items: res }, null, 1));
  check(bad.length === 0, bad.join('; ') + ` | הפרש כללי ${r1(whole.mean)} → ${diffFile}`);
  return `${res.length} רכיבים, נוכחות מזערית ${Math.round(Math.min(...res.filter(r => !r.along).map(r => r.score)) * 100)}% (קווים דקים: יחס דיו ${Math.min(...res.filter(r => r.alongRatios).flatMap(r => r.alongRatios))}–${Math.max(...res.filter(r => r.alongRatios).flatMap(r => r.alongRatios))}), הפרש כללי ${r1(whole.mean)} (${r1(whole.frac * 100)}% פיקסלים) → ${diffFile}`;
});

test('export.deterministic', 'הייצוא דטרמיניסטי: אותם נתונים נותנים אותה תמונה בכל פעם', ['R7'], async () => {
  const page = await open({ dpr: 1 });
  await sleep(2000);
  const r = await app(page, async () => {
    const out = []; let first = null;
    for (let k = 0; k < 5; k++) {
      const I = __qa.canvasData(await __qa.app().renderCanvas());
      if (!first) first = I;
      out.push(__qa.diff(first, I, 30));
      await new Promise(res => setTimeout(res, 150 + 170 * k));
    }
    return out.map(d => ({ mean: Math.round(d.mean * 1000) / 1000, frac: Math.round(d.frac * 100000) / 1000 }));
  });
  const diffs = r.slice(1).filter(d => d.mean > 0);
  check(diffs.length === 0, `מתוך 5 ייצואים רצופים ${diffs.length} שונים מהראשון (הפרש ממוצע עד ${Math.max(...r.map(d => d.mean))}, עד ${Math.max(...r.map(d => d.frac))}% מהפיקסלים) — ` +
    'חשד: html2canvas משכפל את המסמך ואנימציית ‎.fade-up‎ של ‎.stage-wrap‎ מתחילה מחדש בעותק, כך שהלוח מצויר בהיסט תת-פיקסלי משתנה');
  return '5 ייצואים זהים';
});

test('export.divider-ends', 'נאמנות הייצוא: אין נקודת זהב תועה בקצה הדוהה של קווי המפריד', ['R1', 'R7'], async () => {
  const page = await open({ dpr: 1.5 });
  await setData(page, { notes: 'הודעה לבדיקה', layout: 'list' });
  await settle(500);
  await exportCanvas(page);
  const res = await app(page, () => {
    const E = __qa.canvasData(window.__qaCanvas), out = [];
    for (const el of document.querySelectorAll('#poster .p-card-head i, #poster .p-notes-head i, #poster .p-sub i')) {
      if (!el.getClientRects().length) continue;
      const r = __qa.relRect(el);
      /* חיתוך של 8px בכל קצה, ועוד 3px מעל ומתחת; הקצה הדוהה הוא זה שבו בגרדיאנט יש פחות זהב */
      const end = (x) => __qa.crop(E, x * 1.5, (r.y - 3) * 1.5, 8 * 1.5, (r.h + 6) * 1.5);
      const L = end(r.x), R = end(r.x + r.w - 8);
      const peak = (I) => { const bg = __qa.bgOf(I); let m = 0; for (let i = 0; i < I.data.length; i += 4) m = Math.max(m, Math.abs(I.data[i] - bg[0]) + Math.abs(I.data[i + 1] - bg[1]) + Math.abs(I.data[i + 2] - bg[2])); return m; };
      const cs = getComputedStyle(el).backgroundImage;
      /* "to right" — חזק משמאל, דוהה לימין; "to left" — להפך. html2canvas נותן ממוצע אחר, לכן לוקחים את החלש */
      const pl = peak(L), pr = peak(R);
      out.push({ cls: el.parentElement.className + (el.classList.contains('flip') ? ' flip' : ''), faded: Math.min(pl, pr), strong: Math.max(pl, pr), bg: cs.slice(0, 40) });
    }
    return out;
  });
  check(res.length >= 4, 'לא נמצאו קווי מפריד');
  const bad = res.filter(x => x.faded > 90);
  check(bad.length === 0, 'נקודה בקצה הדוהה של קו: ' + bad.map(x => `${x.cls} (שיא ${x.faded})`).join('; '));
  return `${res.length} קווים, שיא בקצה הדוהה ≤ ${Math.max(...res.map(x => x.faded))} (סף 90)`;
});

test('export.themes-layouts', 'כל 5 ערכות הצבע × 2 פריסות: מוצגות ומיוצאות בלי שגיאות', ['AGENTS:בדיקה', 'R6'], async () => {
  const page = await open({ dpr: 1 });
  await page.locator('.tab', { hasText: 'עיצוב ותמונה' }).click();
  const themes = await app(page, () => Object.entries(__qa.app().themes).map(([k, t]) => [k, t.v['--p-edge-1']]));
  check(themes.length === 5, 'מספר ערכות הצבע: ' + themes.length);
  const out = [];
  for (const layout of ['list', 'grid']) {
    await page.locator('.seg button', { hasText: layout === 'list' ? 'עמודה אחת' : 'שתי עמודות' }).click();
    for (let i = 0; i < themes.length; i++) {
      const [k, edge] = themes[i];
      await page.locator('.tdot').nth(i).click();
      await settle(150);
      const st = await app(page, () => ({ theme: __qa.app().d.theme, layout: __qa.app().d.layout, grid: document.querySelector('#poster .p-sections').classList.contains('grid-2') }));
      check(st.theme === k && st.layout === layout, `לחיצה לא החליפה ערכה/פריסה: ${st.theme}/${st.layout}`);
      check(st.grid === (layout === 'grid'), 'מחלקת grid-2 לא תואמת לפריסה');
      const e = await exportCanvas(page);
      const px = await app(page, () => __qa.px(__qa.canvasData(window.__qaCanvas), 540, 3));
      const want = [1, 3, 5].map(j => parseInt(edge.slice(j, j + 2), 16));
      const dist = Math.abs(px[0] - want[0]) + Math.abs(px[1] - want[1]) + Math.abs(px[2] - want[2]);
      check(e.w === 1080 && e.h >= 1836, `${k}/${layout}: מידות ${e.w}×${e.h}`);
      check(dist < 90, `${k}/${layout}: צבע המסגרת בתמונה ${px.slice(0, 3)} רחוק מ-${edge}`);
      out.push(await saveCanvas(page, `theme-${k}-${layout}.png`));
    }
  }
  return out.length + ' תמונות ב-tests/out/theme-*.png';
});

test('poster.grid-overlap', 'פריסת שתי עמודות: אף שעה אינה עולה על שם התפילה, גם בשמות ארוכים ובטקסט חופשי', ['AGENTS:בדיקה'], async () => {
  const page = await open();
  const measure = () => app(page, () => {
    const out = [];
    for (const row of document.querySelectorAll('#poster .p-row')) {
      const lab = row.querySelector('.p-label > span'), tm = row.querySelector('.p-time');
      const rg = document.createRange(); rg.selectNodeContents(lab);
      const lr = [...rg.getClientRects()], tr = tm.getBoundingClientRect(), rr = row.getBoundingClientRect();
      const card = row.closest('.p-card').getBoundingClientRect();
      for (const a of lr) if (a.left < tr.right - 0.5 && a.right > tr.left + 0.5 && a.top < tr.bottom - 0.5 && a.bottom > tr.top + 0.5)
        out.push(`"${lab.textContent}" חופף ל-"${tm.textContent}"`);
      if (tr.left < card.left - 0.5 || tr.right > card.right + 0.5) out.push(`"${tm.textContent}" חורג מהעמודה`);
      if (lr.some(a => a.left < card.left - 0.5 || a.right > card.right + 0.5)) out.push(`"${lab.textContent}" חורג מהעמודה`);
    }
    return out;
  });
  await setData(page, { layout: 'grid' });
  await settle();
  const a = await measure();
  check(a.length === 0, 'ברירת מחדל: ' + a.join('; '));
  await app(page, () => {
    const s = __qa.app().d.sections;
    s[0].items[1].label = 'מנחה ערב שבת קודש וקבלת שבת';
    s[0].items[2].time = 'בצאת הכוכבים'; s[0].items[2].freeText = true;
    s[1].items[4].label = 'ערבית מוצאי שבת קודש';
    s[1].items[2].note = 'בעזרת הנשים';
  });
  await settle();
  const b = await measure();
  await page.locator('#poster').screenshot({ path: path.join(OUT, 'grid-long.png') });
  check(b.length === 0, 'שמות ארוכים: ' + b.join('; ') + ' → tests/out/grid-long.png');
  return 'נבדקו כל השורות';
});

/* ---------- עיצוב הלוח מול דרישות הבעלים ---------- */
test('poster.arch-name', 'שם בית הכנסת כולו בתוך הקשת ואינו חוצה את הקו הפנימי שלה', ['R3'], async () => {
  const page = await open({ dpr: 1.5 });
  const run = async (name) => {
    await setData(page, { synagogue: name });
    await settle(400);
    const A = await posterShot(page);
    const st = await page.addStyleTag({ content: '#poster .p-title{visibility:hidden!important}' });
    await sleep(60);
    const B = await posterShot(page);
    await st.evaluate(n => n.remove());
    return app(page, async ([A, B]) => {
      const a = await __qa.imgData(A), b = await __qa.imgData(B);
      const f = __qa.relRect(document.querySelector('#poster .poster-frame'));
      /* הקו הפנימי: inset 7px מתוך מסגרת 2px, רדיוס 50% / 184px */
      const L = f.x + 9, T = f.y + 9, W = f.w - 18, rx = W / 2, ry = 184, cx = L + rx, cy = T + ry;
      let ink = 0, out = 0, worst = 0, minY = 1e9;
      for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
        const i = (y * a.w + x) * 4;
        const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
        if (d < 150) continue;
        ink++;
        const X = x / 1.5, Y = y / 1.5;
        minY = Math.min(minY, Y);
        let inside = X >= L && X <= L + W && Y >= T;
        if (inside && Y < cy) inside = ((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2 <= 1;
        if (!inside) { out++; }
      }
      const lines = document.querySelector('#poster .p-title').getClientRects().length;
      const rg = document.createRange(); rg.selectNodeContents(document.querySelector('#poster .p-title'));
      return { ink, out, lines: rg.getClientRects().length, minY: Math.round(minY), archTop: T };
    }, [A, B]);
  };
  const def = await run('בית כנסת יחזקאל');
  check(def.ink > 500, 'לא נמצא דיו של השם — בדיקה לא תקפה');
  check(def.out === 0, `שם ברירת המחדל חוצה את קו הקשת: ${def.out} פיקסלים מחוץ לקשת`);
  const longName = 'בית הכנסת אוהל משה ויחזקאל';
  const lng = await run(longName);
  await page.locator('#poster .p-head').screenshot({ path: path.join(OUT, 'arch-long-name.png') });
  check(lng.out === 0, `שם ארוך ("${longName}", ${lng.lines} שורות) חוצה את קו הקשת: ${lng.out} פיקסלים מחוץ לקשת → tests/out/arch-long-name.png`);
  return `ברירת מחדל: 0/${def.ink} מחוץ; שם ארוך: 0/${lng.ink} (${lng.lines} שורות)`;
});

test('poster.portrait', 'הדיוקן בצד הכותרת, מאופק (לא דומיננטי); אין "ע״ש הבן איש חי" בשום מקום', ['R2'], async () => {
  const src = fs.readFileSync(SRC, 'utf8');
  check(!/ע["״׳']?ש\s*הבן\s*איש\s*חי/.test(src), 'הכיתוב "ע"ש הבן איש חי" נמצא ב-index.html');
  const page = await open();
  const st = await app(page, () => {
    const p = document.getElementById('poster').getBoundingClientRect();
    const f = document.querySelector('#poster .p-portrait-frame').getBoundingClientRect();
    const t = document.querySelector('#poster .p-title').getBoundingClientRect();
    return { area: (f.width * f.height) / (p.width * p.height), cx: (f.left + f.width / 2 - p.left) / p.width,
      sameBand: f.top < t.bottom && f.bottom > t.top, text: document.getElementById('poster').innerText };
  });
  check(!/ע["״׳']?ש\s*הבן\s*איש\s*חי/.test(st.text), 'הכיתוב מופיע בלוח');
  check(st.area < 0.03, 'הדיוקן גדול מדי: ' + r1(st.area * 100) + '% משטח הלוח');
  check(st.cx < 0.3 || st.cx > 0.7, 'הדיוקן אינו בצד (מרכזו ב-' + r1(st.cx * 100) + '% מהרוחב)');
  check(st.sameBand, 'הדיוקן אינו בגובה הכותרת');
  return `שטח ${r1(st.area * 100)}%, מרכז ב-${Math.round(st.cx * 100)}% מהרוחב`;
});

test('poster.label-size', 'שם התפילה גדול ובולט כמו השעה (גובה האותיות ≥ 90% מגובה הספרות)', ['R4'], async () => {
  const page = await open({ dpr: 1.5 });
  const res = [];
  for (const layout of ['list', 'grid']) {
    await setData(page, { layout });
    await settle(400);
    const A = await posterShot(page);
    const r = await app(page, async (A) => {
      const a = await __qa.imgData(A), out = [];
      /* שמות בלי עולות ויורדות (ל, ק, ן...) — כדי למדוד את גובה האות הבסיסי */
      for (const row of document.querySelectorAll('#poster .p-row')) {
        const lab = row.querySelector('.p-label > span');
        if (!/^(מנחה ערב שבת|מנחה שנייה)$/.test(lab.textContent)) continue;
        const L = __qa.relRect(lab), T = __qa.relRect(row.querySelector('.p-time'));
        const li = __qa.ink(__qa.crop(a, L.x * 1.5, L.y * 1.5, L.w * 1.5, L.h * 1.5));
        const ti = __qa.ink(__qa.crop(a, T.x * 1.5, T.y * 1.5, T.w * 1.5, T.h * 1.5));
        out.push({ label: lab.textContent, lh: li.inkH, th: ti.inkH, lfs: getComputedStyle(lab).fontSize, tfs: getComputedStyle(row.querySelector('.p-time')).fontSize });
      }
      return out;
    }, A);
    for (const x of r) res.push({ layout, ...x, ratio: x.lh / x.th });
  }
  check(res.length >= 4, 'לא נמצאו שורות למדידה');
  const desc = res.map(x => `${x.layout}: "${x.label}" ${x.lh}px (${x.lfs}) מול ${x.th}px (${x.tfs}) = ${Math.round(x.ratio * 100)}%`);
  const bad = res.filter(x => x.ratio < 0.9);
  check(bad.length === 0, 'שם התפילה קטן מהשעה: ' + desc.join(' | '));
  return desc.join(' | ');
});

test('poster.meta-line', 'שורת הפרשה והתאריך: שני ערכים זהים מוצגים שניהם, ועריכה מתעדכנת מיד', ['R20'], async () => {
  const page = await open();
  await setData(page, { parasha: 'שבת חנוכה', hdate: 'שבת חנוכה' });
  await settle(300);
  const a = await app(page, () => [...document.querySelectorAll('#poster .p-meta > span')].map(s => s.innerText.trim()));
  check(a.length === 2 && a.every(x => x.includes('שבת חנוכה')), 'ערכים זהים: ' + JSON.stringify(a));
  await setData(page, { hdate: '' });
  await settle(300);
  const b = await app(page, () => ({ n: document.querySelectorAll('#poster .p-meta > span').length, sep: [...document.querySelectorAll('#poster .p-meta b')].filter(x => x.offsetParent).length }));
  check(b.n === 1 && b.sep === 0, 'אחרי מחיקת התאריך: ' + JSON.stringify(b));
  const errs = cur.errors.length;
  check(errs === 0, 'שגיאות Alpine');
});

test('poster.notes-below', 'אזור ההודעות מופיע בלוח מתחת לכל הזמנים', ['R5'], async () => {
  const page = await open();
  const empty = await app(page, () => document.querySelector('#poster .p-notes').offsetParent === null);
  check(empty, 'אזור ההודעות מוצג גם כשאין הודעות');
  await setData(page, { notes: 'שיעור תורה אחרי ערבית\nקידוש בחסות משפחת לוי' });
  await setData(page, { layout: 'grid' });
  await settle();
  for (const layout of ['grid', 'list']) {
    await setData(page, { layout });
    await settle();
    const st = await app(page, () => {
      const n = document.querySelector('#poster .p-notes').getBoundingClientRect();
      const rows = [...document.querySelectorAll('#poster .p-row')].map(r => r.getBoundingClientRect().bottom);
      return { top: n.top, maxRow: Math.max(...rows), text: document.querySelector('#poster .p-notes-body').innerText };
    });
    check(st.text.includes('קידוש בחסות משפחת לוי'), 'ההודעה אינה מוצגת');
    check(st.top >= st.maxRow, `${layout}: ההודעות (${r1(st.top)}) אינן מתחת לכל הזמנים (${r1(st.maxRow)})`);
  }
});

/* ---------- סרגל עליון, גלישה ---------- */
for (const w of [360, 390, 430]) {
  test('ui.overflow-' + w, `אין גלישה אופקית ברוחב ${w}px (כל הלשוניות והחלונות)`, ['AGENTS:בדיקה'], async () => {
    const page = await open({ mobile: true, viewport: { width: w, height: 800 } });
    const scan = (where) => app(page, (where) => {
      const vw = document.documentElement.clientWidth, out = [];
      if (document.documentElement.scrollWidth > vw) out.push(`${where}: scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('.poster-stage') || !el.getClientRects().length) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
        if (el.closest('.toast')) continue;
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > vw + 1 || r.left < -1)) out.push(`${where}: ${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} [${Math.round(r.left)}..${Math.round(r.right)}]`);
      }
      return out.slice(0, 6);
    }, where);
    const bad = [];
    for (const tab of ['זמני התפילות', 'כותרת ופרטים', 'עיצוב ותמונה']) {
      await tapEl(page, page.locator('.tab', { hasText: tab }));
      await settle(200);
      bad.push(...await scan(tab));
    }
    await tapEl(page, page.locator('.tab', { hasText: 'זמני התפילות' }));
    await tapEl(page, page.locator('.group').first().locator('.item').nth(1).locator('button.inp-time'));
    await settle(300);
    bad.push(...await scan('בורר השעה'));
    await app(page, () => { __qa.app().tp.open = false; __qa.app().askThen('כותרת', 'טקסט ארוך לבדיקה של חלון האישור במסך צר מאוד', 'מחיקה', null); });
    await settle(300);
    bad.push(...await scan('חלון אישור'));
    await page.screenshot({ path: path.join(OUT, `overflow-${w}.png`) });
    check(bad.length === 0, bad.join('; '));
  });
}

test('ui.topbar', 'סרגל עליון: "שתף בוואטסאפ" ו"הורדה" באותה שורה ובאותו גודל; "תצוגה מקדימה" בראש מסגרת התצוגה', ['R8'], async () => {
  const out = [];
  const bad = [];
  for (const vp of [{ width: 320, height: 640 }, { width: 360, height: 760 }, { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 430, height: 900 }, { width: 1400, height: 900 }]) {
    const page = await open({ mobile: vp.width < 800, viewport: vp });
    const st = await app(page, () => {
      const wa = document.querySelector('.topbar .btn-wa'), dl = [...document.querySelectorAll('.topbar .btn')].find(b => b.textContent.includes('הורדה'));
      const a = wa && wa.getBoundingClientRect(), b = dl && dl.getBoundingClientRect();
      const prev = [...document.querySelectorAll('button')].filter(x => x.textContent.includes('תצוגה מקדימה'));
      return { ok: !!(a && b), a: a && a.toJSON(), b: b && b.toJSON(), waText: wa && wa.textContent.trim(),
        prevInHead: prev.length === 1 && !!prev[0].closest('.stage-head'), prevInTop: prev.some(x => x.closest('.topbar')),
        topBtns: document.querySelectorAll('.topbar button').length };
    });
    if (vp.width < 800) await page.screenshot({ path: path.join(OUT, `topbar-${vp.width}.png`), clip: { x: 0, y: 0, width: vp.width, height: 170 } });
    check(st.ok, 'כפתורי השיתוף/ההורדה חסרים');
    check(st.waText.includes('שתף בוואטסאפ'), 'כיתוב כפתור השיתוף: ' + st.waText);
    if (!(Math.abs(st.a.width - st.b.width) <= 1 && Math.abs(st.a.height - st.b.height) <= 1)) bad.push(`${vp.width}px: גדלים שונים — וואטסאפ ${r1(st.a.width)}×${r1(st.a.height)}, הורדה ${r1(st.b.width)}×${r1(st.b.height)} (tests/out/topbar-${vp.width}.png)`);
    if (!(Math.abs(st.a.top - st.b.top) <= 1)) bad.push(`${vp.width}px: הכפתורים אינם באותה שורה`);
    check(st.prevInHead && !st.prevInTop, `${vp.width}px: כפתור התצוגה המקדימה אינו (רק) ב-.stage-head`);
    check(st.topBtns === 2, `${vp.width}px: בסרגל העליון ${st.topBtns} כפתורים (צריך 2)`);
    out.push(`${vp.width}: ${Math.round(st.a.width)}/${Math.round(st.b.width)}`);
  }
  check(bad.length === 0, bad.join('; '));
  return 'רוחב וואטסאפ/הורדה: ' + out.join(', ');
});

/* ---------- תצוגה מקדימה ---------- */
test('preview.fullscreen-close', 'תצוגה מקדימה: מסך מלא, תמונה בלבד ו-X; נסגרת ב-X, בהקשה על התמונה, ב-Esc ובכפתור החזרה', ['R10', 'AGENTS:בדיקה'], async () => {
  const page = await open({ mobile: true });
  await sleep(2200);                                   /* התמונה הוכנה ברקע */
  const openIt = async () => {
    await tapEl(page, page.locator('.stage-head button', { hasText: 'תצוגה מקדימה' }));
    await page.waitForFunction(() => { const i = document.querySelector('.preview-full img'); return __qa.app().showPreview && i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
    await settle(350);
  };
  const shown = () => app(page, () => __qa.app().showPreview && getComputedStyle(document.querySelector('.preview-full')).display !== 'none');
  await openIt();
  const st = await app(page, () => {
    const m = document.querySelector('.preview-full').getBoundingClientRect(), img = document.querySelector('.preview-full img').getBoundingClientRect();
    const vis = [...document.querySelectorAll('button')].filter(b => { const r = b.getBoundingClientRect(); if (!r.width) return false; const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top && (top === b || b.contains(top)); });
    const im = document.querySelector('.preview-full img');
    return { m: m.toJSON(), img: img.toJSON(), vw: innerWidth, vh: innerHeight, visible: vis.map(b => b.className), nat: [im.naturalWidth, im.naturalHeight] };
  });
  await page.screenshot({ path: path.join(OUT, 'preview-open.png') });
  check(st.m.left <= 0 && st.m.top <= 0 && st.m.width >= st.vw && st.m.height >= st.vh, 'החלון אינו במסך מלא');
  check(st.visible.length === 1 && /prev-close/.test(st.visible[0]), 'כפתורים גלויים בתצוגה: ' + JSON.stringify(st.visible));
  check(st.img.left >= -0.5 && st.img.top >= -0.5 && st.img.right <= st.vw + 0.5 && st.img.bottom <= st.vh + 0.5, 'התמונה חורגת מהמסך (נחתכת)');
  const ar = (st.img.width / st.img.height) / (st.nat[0] / st.nat[1]);
  check(Math.abs(ar - 1) < 0.01, 'יחס הממדים של התמונה המוצגת מעוות: ' + r1(ar));
  check(Math.max(st.img.width / st.vw, st.img.height / st.vh) > 0.97, 'התמונה אינה ממלאת את המסך');
  /* X */
  await tapEl(page, page.locator('.prev-close')); await settle(400);
  check(!(await shown()), 'X לא סגר את התצוגה');
  /* הקשה על התמונה */
  await openIt();
  await tapEl(page, page.locator('.preview-full img')); await settle(400);
  check(!(await shown()), 'הקשה על התמונה לא סגרה את התצוגה');
  /* Esc */
  await openIt();
  await page.keyboard.press('Escape'); await settle(400);
  check(!(await shown()), 'Esc לא סגר את התצוגה');
  /* מקש החזרה של אנדרואיד */
  await openIt();
  const ret = await app(page, () => window.__closeTopLayer()); await settle(400);
  check(ret === true && !(await shown()), '__closeTopLayer לא סגר את התצוגה (החזיר ' + ret + ')');
  check(await app(page, () => window.__closeTopLayer()) === false, '__closeTopLayer מחזיר true כשאין שכבה פתוחה');
  return `תמונה ${st.nat.join('×')}, מוצגת ${Math.round(st.img.width)}×${Math.round(st.img.height)} במסך ${st.vw}×${st.vh}`;
});

test('preview.dimensions', 'תמונת התצוגה המקדימה זהה בממדיה ובתוכנה לקנבס הייצוא (לא חתוכה ולא מוקטנת)', ['R6', 'R10'], async () => {
  const page = await open({ mobile: true });
  const report = [];
  /* (א) מיד אחרי הטעינה, לפני ההכנה ברקע; (ב) מהמטמון; (ג) מיד אחרי עריכה */
  for (const [label, prep] of [['מיד', async () => {}], ['מהמטמון', async () => sleep(2500)], ['אחרי עריכה', async () => setData(page, { synagogue: 'בית כנסת אוהל מועד' })]]) {
    await prep();
    await app(page, () => __qa.app().openPreview());
    await page.waitForFunction(() => { const i = document.querySelector('.preview-full img'); return i && i.complete && i.naturalWidth > 0; });
    const r = await app(page, async () => {
      const im = document.querySelector('.preview-full img');
      const P = await __qa.imgData(im.src);
      const c = await __qa.app().renderCanvas();
      const C = __qa.canvasData(c);
      const p = document.getElementById('poster');
      const same = P.w === C.w && P.h === C.h;
      return { nat: [im.naturalWidth, im.naturalHeight], canvas: [c.width, c.height], poster: [p.offsetWidth * 1.5, parseFloat(getComputedStyle(p).height) * 1.5], diff: same ? __qa.diff(P, C).mean : null };
    });
    report.push(`${label}: תצוגה ${r.nat.join('×')}, קנבס ${r.canvas.join('×')}, לוח×1.5 ${r.poster.join('×')}` + (r.diff !== null ? `, הפרש ${r1(r.diff)}` : ''));
    check(r.nat[0] === r.canvas[0] && r.nat[1] === r.canvas[1], 'ממדי התצוגה שונים מהקנבס — ' + report.join(' | '));
    check(Math.abs(r.canvas[1] - r.poster[1]) <= 1, 'הקנבס אינו בגובה הלוח — ' + report.join(' | '));
    check(r.diff < 1, 'תוכן התצוגה שונה מהקנבס הנוכחי (תמונה ישנה?) — ' + report.join(' | '));
    await app(page, () => __qa.app().closePreview());
    await settle(200);
  }
  return report.join(' | ');
});

/* ---------- בורר השעה ---------- */
test('timepicker.wheel-and-text', 'בורר השעה: נפתח בהקשה על השעה, גלגלים משנים את השעה, טקסט חופשי מוצג בלוח', ['R11', 'AGENTS:בדיקה'], async () => {
  const page = await open({ mobile: true });
  const row = page.locator('.group').first().locator('.item').nth(1);
  const it = () => app(page, () => { const x = __qa.app().d.sections[0].items[1]; return { time: x.time, freeText: x.freeText, poster: [...document.querySelectorAll('#poster .p-row')].find(r => r.textContent.includes(x.label)).querySelector('.p-time').textContent, cls: [...document.querySelectorAll('#poster .p-row')].find(r => r.textContent.includes(x.label)).querySelector('.p-time').className, btn: document.querySelectorAll('.group')[0].querySelectorAll('.item')[1].querySelector('.inp-time').textContent }; });
  check((await it()).time === '18:20', 'נתון פתיחה לא צפוי');
  await tapEl(page, row.locator('button.inp-time'));
  await settle(400);
  const o = await app(page, () => ({ open: __qa.app().tp.open, disp: document.querySelector('.tp-display').textContent, h: document.querySelector('.tp-wheel').scrollTop, m: document.querySelectorAll('.tp-wheel')[1].scrollTop }));
  check(o.open, 'הבורר לא נפתח בהקשה על השעה');
  check(o.disp === '18:20', 'תצוגת הבורר: ' + o.disp);
  check(Math.abs(o.h - 18 * 46) < 2 && Math.abs(o.m - 20 * 46) < 2, `הגלגלים אינם על 18:20 (scrollTop ${o.h}/${o.m})`);
  /* הקשה על שעה בגלגל */
  await tapEl(page, page.locator('.tp-wheel').first().locator('.tp-item', { hasText: /^19$/ }));
  await settle(600);
  let s = await it();
  check(s.time === '19:20' && s.poster === '19:20', 'הקשה על "19" בגלגל: ' + JSON.stringify(s));
  /* גלילת מגע אמיתית בגלגל הדקות — 5 שורות למטה */
  const mw = await center(page.locator('.tp-wheel').nth(1));
  const cdp = await page.context().newCDPSession(page);
  const sx = mw.x, sy = mw.y + 60;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
  for (let i = 1; i <= 20; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy - 46 * 5 * i / 20 }] }); await sleep(16); }
  await sleep(100);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await settle(1000);
  s = await it();
  const disp = await page.locator('.tp-display').textContent();
  check(/^19:(2[3-7])$/.test(s.time), 'גלילת הדקות לא שינתה את השעה כמצופה (צפוי ~19:25): ' + s.time);
  check(disp === s.time && s.poster === s.time && s.btn === s.time, `אי התאמה: בורר ${disp}, נתון ${s.time}, לוח ${s.poster}, כפתור ${s.btn}`);
  const wheelTime = s.time;
  /* טקסט חופשי */
  await tapEl(page, page.locator('.tp-free input'));
  await page.keyboard.type('בצאת השבת');
  await settle(300);
  s = await it();
  check(s.time === 'בצאת השבת' && s.freeText, 'טקסט חופשי לא נשמר: ' + JSON.stringify(s));
  check(s.poster === 'בצאת השבת' && /\btxt\b/.test(s.cls), 'הטקסט אינו מוצג בלוח בעיצוב טקסט: ' + s.poster + ' ' + s.cls);
  /* מחיקת הטקסט מחזירה את השעה מהגלגלים */
  await page.locator('.tp-free input').fill('');
  await settle(200);
  s = await it();
  check(s.time === wheelTime && !s.freeText, 'מחיקת הטקסט לא החזירה את השעה: ' + s.time);
  await page.keyboard.type('אחרי השיעור');
  await tapEl(page, page.locator('.tp-card .modal-actions .btn', { hasText: 'אישור' }));
  await settle(400);
  check(!(await app(page, () => __qa.app().tp.open)), 'אישור לא סגר את הבורר');
  s = await it();
  check(s.poster === 'אחרי השיעור', 'הטקסט לא נשאר אחרי אישור');
  /* פתיחה מחדש מציגה את הטקסט */
  await tapEl(page, row.locator('button.inp-time')); await settle(300);
  check(await page.locator('.tp-free input').inputValue() === 'אחרי השיעור', 'הטקסט אינו מוצג בפתיחה מחדש');
  check(await app(page, () => window.__closeTopLayer()) === true && !(await app(page, () => __qa.app().tp.open)), 'כפתור החזרה לא סגר את הבורר');
  return `גלגל → ${wheelTime}`;
});

/* ---------- מחיקה ואישור ---------- */
test('delete.askThen', 'מחיקת שורה: חלון askThen; ביטול משאיר, אישור מוחק; כל שורה עם סמל מחיקה בלבד', ['R12', 'כלל 5', 'AGENTS:בדיקה'], async () => {
  const page = await open({ mobile: true });
  const tools = await app(page, () => [...document.querySelectorAll('.group-body .item')].map(r => ({ btns: r.querySelectorAll('button').length, tools: r.querySelectorAll('.item-tools button').length, del: r.querySelectorAll('.item-tools button.del').length })));
  check(tools.every(t => t.btns === 2 && t.tools === 1 && t.del === 1), 'בשורה יש כפתורים מעבר לשעה ולמחיקה: ' + JSON.stringify(tools[0]));
  const grp = page.locator('.group').first();
  const before = await labels(page, 0);
  await tapEl(page, grp.locator('.item').nth(2).locator('.icon-btn.del'));
  await settle(350);
  const ask = await app(page, () => ({ open: __qa.app().ask.open, text: document.querySelector('.modal-sub[x-text="ask.text"]').textContent, vis: getComputedStyle([...document.querySelectorAll('.modal')][1]).display !== 'none' }));
  check(ask.open && ask.vis, 'חלון האישור לא הופיע');
  check(ask.text.includes(before[2]), 'חלון האישור אינו מציין את השורה: ' + ask.text);
  await page.screenshot({ path: path.join(OUT, 'delete-ask.png') });
  await tapEl(page, page.locator('.modal .btn', { hasText: 'ביטול' }));
  await settle(350);
  check(JSON.stringify(await labels(page, 0)) === JSON.stringify(before), 'ביטול מחק את השורה');
  check(!(await app(page, () => __qa.app().ask.open)), 'ביטול לא סגר את החלון');
  /* Esc ו-__closeTopLayer סוגרים בלי למחוק */
  await tapEl(page, grp.locator('.item').nth(2).locator('.icon-btn.del')); await settle(300);
  await page.keyboard.press('Escape'); await settle(300);
  check(!(await app(page, () => __qa.app().ask.open)) && (await labels(page, 0)).length === 3, 'Esc לא סגר / מחק');
  await tapEl(page, grp.locator('.item').nth(2).locator('.icon-btn.del')); await settle(300);
  check(await app(page, () => window.__closeTopLayer()) === true && (await labels(page, 0)).length === 3, 'כפתור החזרה לא סגר את החלון');
  await settle(300);
  /* אישור */
  await tapEl(page, grp.locator('.item').nth(2).locator('.icon-btn.del')); await settle(300);
  await tapEl(page, page.locator('.modal .btn-del'));
  await settle(400);
  const after = await labels(page, 0);
  check(after.length === 2 && !after.includes(before[2]), 'האישור לא מחק: ' + after.join(','));
  const inPoster = await app(page, (l) => document.getElementById('poster').innerText.includes(l), before[2]);
  check(!inPoster, 'השורה שנמחקה עדיין בלוח');
  /* מחיקת קבוצה גם היא באישור */
  await tapEl(page, page.locator('.group').nth(1).locator('.group-head .icon-btn.del')); await settle(300);
  check(await app(page, () => __qa.app().ask.open), 'מחיקת קבוצה בלי אישור');
  await tapEl(page, page.locator('.modal .btn', { hasText: 'ביטול' })); await settle(300);
  check(await app(page, () => __qa.app().d.sections.length) === 3, 'ביטול מחק קבוצה');
});

/* ---------- גרירה לשינוי סדר ---------- */
test('drag.touch-time', 'גרירה במגע: לחיצה ארוכה על השעה וגרירה משנה את הסדר, ואינה פותחת את הבורר', ['R13', 'AGENTS:בדיקה'], async () => {
  const page = await open({ mobile: true });
  const grp = page.locator('.group').nth(1);
  await grp.locator('.item').nth(2).scrollIntoViewIfNeeded();
  const before = await labels(page, 1);
  const a = await center(grp.locator('.item').nth(0).locator('button.inp-time'));
  const b = await center(grp.locator('.item').nth(1).locator('button.inp-time'));
  const h = b.y - a.y;
  let mid = null;
  await touchDrag(page, a, { x: a.x, y: a.y + 2 * h }, { during: async (ph) => { if (ph === 'moved') mid = await app(page, () => !!document.querySelector('.item.dragging')); } });
  await settle(600);
  const after = await labels(page, 1);
  const tp = await app(page, () => __qa.app().tp.open);
  const want = [before[1], before[2], before[0], before[3], before[4]];
  check(mid, 'השורה לא נכנסה למצב גרירה');
  check(JSON.stringify(after) === JSON.stringify(want), `הסדר לא השתנה כמצופה: ${after.join(' / ')}`);
  check(!tp, 'הבורר נפתח בסוף הגרירה');
  const posterOrder = await app(page, () => [...document.querySelectorAll('#poster .p-card')][1].innerText);
  check(posterOrder.indexOf(want[0]) < posterOrder.indexOf(want[1]), 'הסדר בלוח לא עודכן');
  /* הקשה קצרה על השעה עדיין פותחת את הבורר */
  await settle(400);
  await tapEl(page, grp.locator('.item').nth(0).locator('button.inp-time'));
  await settle(400);
  check(await app(page, () => __qa.app().tp.open), 'הקשה קצרה על השעה לא פתחה את הבורר אחרי גרירה');
  return after.join(' / ');
});

test('drag.touch-input', 'גרירה במגע מתוך שדה טקסט (שם התפילה / הערה); אין בחירת טקסט', ['R13'], async () => {
  const page = await open({ mobile: true });
  const grp = page.locator('.group').nth(1);
  await grp.locator('.item').nth(2).scrollIntoViewIfNeeded();
  const before = await labels(page, 1);
  const rows = await Promise.all([0, 1, 2, 3, 4].map(i => center(grp.locator('.item').nth(i).locator('.item-line input'))));
  const h = rows[1].y - rows[0].y;
  let sel = [];
  const probe = async (ph) => sel.push(ph + ':' + JSON.stringify(await app(page, () => { const a = document.activeElement; return { s: window.getSelection().toString(), r: a && a.tagName === 'INPUT' ? a.selectionEnd - a.selectionStart : 0 }; })));
  await touchDrag(page, rows[4], { x: rows[4].x, y: rows[4].y - 3 * h }, { during: probe });
  await settle(600);
  const after = await labels(page, 1);
  const want = [before[0], before[4], before[1], before[2], before[3]];
  check(JSON.stringify(after) === JSON.stringify(want), `גרירה משדה שם התפילה: ${after.join(' / ')}`);
  const end = await app(page, () => { const a = document.activeElement; return { s: window.getSelection().toString(), tag: a && a.tagName, r: a && a.tagName === 'INPUT' ? a.selectionEnd - a.selectionStart : 0 }; });
  check(sel.every(x => x.includes('"s":""') && x.includes('"r":0')) && end.s === '' && end.r === 0, 'נבחר טקסט בזמן הגרירה: ' + sel.join(' ') + ' סוף: ' + JSON.stringify(end));
  check(!(await app(page, () => __qa.app().tp.open)), 'הבורר נפתח בסוף הגרירה');
  /* גרירה משדה ההערה */
  await settle(400);
  const n0 = await center(grp.locator('.item').nth(0).locator('.note-inp'));
  await touchDrag(page, n0, { x: n0.x, y: n0.y + h });
  await settle(600);
  const after2 = await labels(page, 1);
  check(after2[1] === want[0] && after2[0] === want[1], `גרירה משדה ההערה: ${after2.join(' / ')}`);
  return after2.join(' / ') + (end.tag === 'INPUT' ? ' (אחרי הגרירה המיקוד בשדה — המקלדת עלולה להיפתח)' : '');
});

test('drag.longpress-no-select', 'לחיצה ארוכה על שדה טקסט ושחרור בלי תזוזה: אין בחירת מילה, אין שינוי סדר', ['R13'], async () => {
  const page = await open({ mobile: true });
  const grp = page.locator('.group').nth(1);
  await grp.locator('.item').nth(2).scrollIntoViewIfNeeded();
  const before = await labels(page, 1);
  const p = await center(grp.locator('.item').nth(2).locator('.item-line input'));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  await sleep(1100);                                      /* מעבר לסף הלחיצה הארוכה של כרום (~500ms) */
  const during = await app(page, () => ({ s: window.getSelection().toString(), drag: !!document.querySelector('.item.dragging') }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await settle(500);
  const end = await app(page, () => { const a = document.activeElement; return { s: window.getSelection().toString(), tag: a && a.tagName, r: a && a.tagName === 'INPUT' ? a.selectionEnd - a.selectionStart : 0 }; });
  check(during.s === '' && end.s === '' && end.r === 0, `נבחר טקסט: במהלך "${during.s}", בסוף "${end.s}" (${end.r} תווים)`);
  check(during.drag, 'לחיצה ארוכה לא נכנסה למצב גרירה');
  check(JSON.stringify(await labels(page, 1)) === JSON.stringify(before), 'הסדר השתנה בלי גרירה');
});

test('drag.quick-swipe', 'החלקה מהירה (גלילה) על שורה אינה גוררת', ['R13'], async () => {
  const page = await open({ mobile: true });
  const grp = page.locator('.group').nth(1);
  await grp.locator('.item').nth(2).scrollIntoViewIfNeeded();
  const before = await labels(page, 1);
  const p = await center(grp.locator('.item').nth(1).locator('.item-line input'));
  await touchDrag(page, p, { x: p.x, y: p.y + 160 }, { hold: 30, steps: 8, stepMs: 12 });
  await settle(700);
  check(JSON.stringify(await labels(page, 1)) === JSON.stringify(before), 'החלקה מהירה שינתה את הסדר');
  check(!(await app(page, () => !!document.querySelector('.item.dragging'))), 'שורה נשארה במצב גרירה');
});

test('drag.two-finger', 'אצבע שנייה באמצע גרירה: הגרירה מסתיימת נקי — אין שורה תקועה, והמסך ממשיך להגיב', ['R13'], async () => {
  const page = await open({ mobile: true });
  const grp = page.locator('.group').nth(1);
  await grp.locator('.item').nth(2).scrollIntoViewIfNeeded();
  const a = await center(grp.locator('.item').nth(0).locator('.item-line input'));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
  await sleep(450);
  for (let i = 1; i <= 5; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x, y: a.y + 10 * i, id: 1 }] }); await sleep(16); }
  const mid = await app(page, () => !!document.querySelector('.item.dragging'));
  /* אצבע שנייה נוגעת, שתיהן זזות, ואז שתיהן מורמות */
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y + 50, id: 1 }, { x: a.x - 120, y: a.y + 200, id: 2 }] });
  for (let i = 1; i <= 5; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x, y: a.y + 50 + 10 * i, id: 1 }, { x: a.x - 120, y: a.y + 200 - 20 * i, id: 2 }] }); await sleep(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: a.x - 120, y: a.y + 100, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await settle(700);
  const st = await app(page, () => ({
    dragging: document.querySelectorAll('.item.dragging').length, list: document.querySelectorAll('.dragging-list').length,
    noSelect: document.body.classList.contains('no-select'),
    transforms: [...document.querySelectorAll('.item')].filter(r => r.style.transform).length,
    n: __qa.app().d.sections[1].items.length
  }));
  check(mid, 'הגרירה לא התחילה (בדיקה לא תקפה)');
  check(st.dragging === 0 && st.list === 0 && !st.noSelect && st.transforms === 0, 'שורה נשארה תקועה: ' + JSON.stringify(st));
  check(st.n === 5, 'מספר השורות השתנה: ' + st.n);
  /* המסך ממשיך להגיב */
  await tapEl(page, grp.locator('.item').nth(3).locator('button.inp-time')); await settle(400);
  check(await app(page, () => __qa.app().tp.open), 'הקשה אחרי הגרירה לא פתחה את הבורר');
});

test('drag.mouse', 'גרירה בעכבר (מחשב): לחיצה ארוכה על שם התפילה וגרירה משנה את הסדר', ['R13'], async () => {
  const page = await open({ viewport: { width: 1400, height: 1100 } });
  const grp = page.locator('.group').nth(1);
  await grp.locator('.item').nth(3).scrollIntoViewIfNeeded();
  const before = await labels(page, 1);
  const a = await center(grp.locator('.item').nth(0).locator('.item-line input'));
  const b = await center(grp.locator('.item').nth(1).locator('.item-line input'));
  await mouseDrag(page, a, { x: a.x, y: a.y + (b.y - a.y) * 3 });
  await settle(600);
  const after = await labels(page, 1);
  const want = [before[1], before[2], before[3], before[0], before[4]];
  check(JSON.stringify(after) === JSON.stringify(want), 'עכבר: ' + after.join(' / '));
  const sel = await app(page, () => window.getSelection().toString());
  check(sel === '', 'נבחר טקסט: ' + sel);
});

/* ---------- קיפול קבוצה ---------- */
test('group.fold', 'מתג קבוצה כבוי: הגוף מתקפל באנימציה ל-0, השורות לא לחיצות, מצבי המתגים נשמרים; דלוק: נפתח חזרה', ['R15', 'R14'], async () => {
  const page = await open({ mobile: true });
  const g = page.locator('.group').first();
  await g.scrollIntoViewIfNeeded();
  const fold = g.locator('.group-fold');
  /* ראש הקבוצה נבדל ברקעו מהשורות */
  await g.locator('.item').nth(1).scrollIntoViewIfNeeded();
  const colors = await app(page, async () => {
    const gh = document.querySelector('.group-head'), gb = document.querySelector('.group-body');
    return { head: getComputedStyle(gh).backgroundImage + getComputedStyle(gh).backgroundColor, body: getComputedStyle(gb).backgroundImage + getComputedStyle(gb).backgroundColor };
  });
  check(colors.head !== colors.body, 'לראש הקבוצה אותו רקע כמו לשורות');
  const hb = await g.locator('.group-head').boundingBox(), bb = await g.locator('.item').nth(1).boundingBox();
  const shotHead = await page.screenshot({ clip: { x: hb.x + hb.width * 0.4, y: hb.y + 2, width: 20, height: 6 } });
  const shotBody = await page.screenshot({ clip: { x: bb.x + bb.width * 0.4, y: bb.y + bb.height - 4, width: 20, height: 3 } });
  const cd = await app(page, async ([a, b]) => { const A = await __qa.imgData(a), B = await __qa.imgData(b); const m = (I) => [0, 1, 2].map(c => { let s = 0; for (let i = c; i < I.data.length; i += 4) s += I.data[i]; return s / (I.data.length / 4); }); const x = m(A), y = m(B); return { head: x.map(Math.round), body: y.map(Math.round), d: Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) }; }, ['data:image/png;base64,' + shotHead.toString('base64'), 'data:image/png;base64,' + shotBody.toString('base64')]);
  check(cd.d > 20, `רקע ראש הקבוצה ${cd.head} כמעט זהה לרקע השורות ${cd.body}`);
  const H = await fold.evaluate(e => e.offsetHeight);
  const states = await app(page, () => __qa.app().d.sections[0].items.map(i => i.enabled));
  check(H > 100, 'גובה גוף הקבוצה ' + H);
  const sampler = () => app(page, () => { window.__qaS = []; const el = document.querySelector('.group-fold'); const t0 = performance.now(); const tick = () => { window.__qaS.push(el.offsetHeight); if (performance.now() - t0 < 700) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const tb = await center(g.locator('.item').nth(0).locator('button.inp-time'));
  /* כיבוי */
  await sampler();
  await tapEl(page, g.locator('.group-head label.sw'));
  await sleep(60);
  await page.touchscreen.tap(tb.x, tb.y);                /* הקשה על שורה תוך כדי קיפול */
  await sleep(800);
  const s1 = await app(page, () => window.__qaS);
  const offState = await app(page, () => ({ en: __qa.app().d.sections[0].enabled, h: document.querySelector('.group-fold').offsetHeight, inert: document.querySelector('.group-body').inert, tp: __qa.app().tp.open, poster: document.getElementById('poster').innerText.includes(__qa.app().d.sections[0].title) }));
  check(!offState.en, 'המתג לא כיבה את הקבוצה');
  check(s1.some(v => v > H * 0.15 && v < H * 0.85), 'לא נצפה גובה ביניים — אין אנימציה: ' + s1.slice(0, 12).join(','));
  check(offState.h === 0, 'הגוף לא התקפל לגמרי: ' + offState.h);
  check(!offState.tp, 'הקשה על שורה בקבוצה כבויה פתחה את בורר השעה');
  check(offState.inert, 'גוף הקבוצה אינו inert');
  check(!offState.poster, 'הקבוצה הכבויה עדיין מוצגת בלוח');
  check(JSON.stringify(await app(page, () => __qa.app().d.sections[0].items.map(i => i.enabled))) === JSON.stringify(states), 'מצבי המתגים של השורות השתנו');
  /* הקשה במקום שבו הייתה השורה אינה פוגעת בגוף הקבוצה המקופלת */
  const hit = await app(page, ([x, y]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('.group') === document.querySelector('.group') && e.closest('.group-body')); }, [tb.x, tb.y]);
  check(!hit, 'גוף הקבוצה המקופלת עדיין מקבל הקשות');
  /* הדלקה */
  await sampler();
  await tapEl(page, g.locator('.group-head label.sw'));
  await sleep(800);
  const s2 = await app(page, () => window.__qaS);
  const onState = await app(page, () => ({ h: document.querySelector('.group-fold').offsetHeight, style: document.querySelector('.group-fold').style.height, inert: document.querySelector('.group-body').inert }));
  check(s2.some(v => v > H * 0.15 && v < H * 0.85), 'לא נצפה גובה ביניים בפתיחה: ' + s2.slice(0, 12).join(','));
  check(Math.abs(onState.h - H) <= 1 && onState.style === 'auto', `הגוף לא חזר לגובה אוטומטי: ${onState.h}/${H} (${onState.style})`);
  check(!onState.inert, 'השורות נשארו נעולות');
  check(JSON.stringify(await app(page, () => __qa.app().d.sections[0].items.map(i => i.enabled))) === JSON.stringify(states), 'מצבי המתגים השתנו אחרי הפתיחה');
  await tapEl(page, g.locator('.item').nth(0).locator('button.inp-time')); await settle(300);
  check(await app(page, () => __qa.app().tp.open), 'השורות אינן לחיצות אחרי הפתיחה');
  /* קבוצה שכבויה מההתחלה מקופלת בטעינה */
  const third = await app(page, () => document.querySelectorAll('.group-fold')[2].offsetHeight);
  check(third === 0, 'קבוצה כבויה בטעינה אינה מקופלת: ' + third);
  return `גובה ${H}px; דגימות קיפול ${s1.filter((v, i) => i % 4 === 0).slice(0, 6).join(',')}`;
});

/* ---------- מבנה מסך הניהול ---------- */
test('ui.structure', 'מסך הניהול: הודעות בתחתית לשונית הזמנים; "הודעות מודגשות"; אין "שורות תחתונות"; אין הוספה מהירה; כותרת גנרית', ['R16', 'R18', 'R19'], async () => {
  const src = fs.readFileSync(SRC, 'utf8');
  check(!src.includes('שורות תחתונות'), '"שורות תחתונות" מופיע ב-index.html');
  const page = await open();
  const st = await app(page, () => {
    const tab = document.querySelector('[x-show="tab===\'times\'"]');
    const notes = tab.querySelector('textarea[x-model="d.notes"]');
    const lastGroup = [...tab.querySelectorAll('.group')].pop();
    const titles = [...document.querySelectorAll('.sect-title')].map(e => e.textContent.trim());
    return {
      notesAfterGroups: !!(notes && lastGroup && (lastGroup.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING)),
      notesIsLast: !!notes && [...tab.children].filter(c => c.tagName !== 'TEMPLATE').pop().contains(notes),
      titles, body: document.body.innerText,
      brand: document.querySelector('.brand').innerText, syn: __qa.app().d.synagogue
    };
  });
  check(st.notesAfterGroups && st.notesIsLast, 'שדה ההודעות אינו בתחתית לשונית הזמנים');
  check(st.titles.includes('הודעות מודגשות'), 'אין מקטע "הודעות מודגשות": ' + st.titles.join(', '));
  check(!st.body.includes('שורות תחתונות'), '"שורות תחתונות" מוצג במסך');
  check(!/הוספה מהירה|הוסף מהיר|תבניות מהירות/.test(st.body), 'נמצא אזור הוספה מהירה');
  check(!st.brand.includes(st.syn) && !st.brand.includes('יחזקאל'), 'שם בית הכנסת מופיע בכותרת האפליקציה: ' + st.brand);
});

test('address.default-toggle', 'כתובת: ריקה כברירת מחדל עם דוגמה ב-placeholder; המתג מסתיר אותה מהלוח', ['R17'], async () => {
  const page = await open({ mobile: true });
  await tapEl(page, page.locator('.tab', { hasText: 'כותרת ופרטים' }));
  const inp = page.locator('input[x-model="d.address"]');
  check(await inp.inputValue() === '', 'שדה הכתובת אינו ריק: ' + await inp.inputValue());
  check(((await inp.getAttribute('placeholder')) || '').length > 3, 'אין placeholder לדוגמה');
  check(await app(page, () => document.querySelector('#poster .p-addr').offsetParent === null), 'כתובת ריקה מוצגת בלוח');
  await tapEl(page, inp);
  await page.keyboard.type('רחוב הרצל 5, בני ברק');
  await settle(300);
  check(await app(page, () => { const a = document.querySelector('#poster .p-addr'); return a.offsetParent !== null && a.textContent === 'רחוב הרצל 5, בני ברק'; }), 'הכתובת אינה מוצגת בלוח');
  await tapEl(page, page.locator('.field', { hasText: 'הצג את הכתובת' }).locator('label.sw'));
  await settle(300);
  const st = await app(page, () => ({ show: __qa.app().d.showAddress, vis: document.querySelector('#poster .p-addr').offsetParent !== null, addr: __qa.app().d.address }));
  check(!st.show && !st.vis, 'המתג לא הסתיר את הכתובת מהלוח');
  check(st.addr === 'רחוב הרצל 5, בני ברק', 'הכתובת נמחקה מהנתונים');
  await exportCanvas(page);
  return 'הוסתרה, הנתון נשמר';
});

/* ---------- תאריך ופרשה ---------- */
test('hebcal.parasha', 'פרשה ותאריך עברי (מנהג ארץ ישראל) לתאריכים שנבדקו ידנית', ['R20'], async () => {
  const page = await open();
  const cases = [
    ['2025-09-27', 'וילך', 'ה׳ בתשרי תשפ״ו'],          /* שבת שובה, ר"ה בשלישי */
    ['2025-10-18', 'בראשית', 'כ״ו בתשרי תשפ״ו'],
    ['2026-03-28', 'צו', 'י׳ בניסן תשפ״ו'],             /* שבת הגדול בשנה פשוטה */
    ['2026-04-04', 'שבת חול המועד פסח', 'י״ז בניסן תשפ״ו'],
    ['2026-04-11', 'שמיני', 'כ״ד בניסן תשפ״ו'],
    ['2026-05-23', 'נשא', 'ז׳ בסיוון תשפ״ו'],           /* בארץ — נשא; בחו"ל — שבועות ב' */
    ['2026-06-27', 'בלק', 'י״ב בתמוז תשפ״ו'],           /* בארץ בלק לבד; בחו"ל חקת־בלק */
    ['2026-07-11', 'מטות־מסעי', 'כ״ו בתמוז תשפ״ו'],
    ['2026-07-18', 'דברים', 'ד׳ באב תשפ״ו'],            /* שבת חזון */
    ['2026-09-05', 'נצבים־וילך', 'כ״ג באלול תשפ״ו'],   /* ר"ה תשפ"ז בשבת → מחוברות */
    ['2026-09-12', 'ראש השנה', 'א׳ בתשרי תשפ״ז'],
    ['2026-09-19', 'האזינו', 'ח׳ בתשרי תשפ״ז'],         /* שבת שובה תשפ"ז — האזינו (וילך נקראה עם נצבים) */
    ['2026-09-26', 'סוכות', 'ט״ו בתשרי תשפ״ז'],
    ['2026-10-03', 'שמחת תורה', 'כ״ב בתשרי תשפ״ז'],
    ['2026-10-10', 'בראשית', 'כ״ט בתשרי תשפ״ז'],
    ['2026-10-17', 'נח', 'ו׳ בחשוון תשפ״ז']
  ];
  const got = await app(page, (cases) => cases.map(([s]) => { const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d); return [parashaFor(dt), hebrewDate(dt)]; }), cases);
  const bad = cases.filter((c, i) => got[i][0] !== c[1] || got[i][1] !== c[2]).map(c => `${c[0]}: צפוי ${c[1]} / ${c[2]}, התקבל ${got[cases.indexOf(c)].join(' / ')}`);
  /* שלמות: לכל שבת בשנה יש קריאה, וכל 54 הפרשות נקראות פעם אחת בשנה */
  const year = await app(page, () => {
    const out = {}; let missing = 0;
    for (let t = Date.UTC(2025, 9, 18, 12); t < Date.UTC(2026, 8, 12, 12); t += 7 * 86400000) {
      const p = parashaFor(new Date(t)); if (!p) { missing++; continue; }
      for (const x of p.split('־')) out[x] = (out[x] || 0) + 1;
    }
    return { missing, dup: Object.entries(out).filter(([k, v]) => v > 1 && PAR.includes(k)).map(([k]) => k), absent: PAR.filter(p => !out[p]) };
  });
  check(bad.length === 0, bad.join(' | '));
  check(year.missing === 0 && year.dup.length === 0 && year.absent.length === 0, 'שנת תשפ"ו: ' + JSON.stringify(year));
  return cases.length + ' תאריכים; שנת תשפ"ו שלמה';
});

test('hebcal.autofill', 'מילוי אוטומטי לשבת הקרובה, בלי רשת: א׳–ה׳ → השבת הקרובה, שישי → מחר, שבת (כל שעה) → השבת הבאה', ['R20'], async () => {
  const out = [];
  for (const [now, par, hd, tz] of [
    ['2026-10-14T10:00:00+03:00', 'פרשת נח', 'ו׳ בחשוון תשפ״ז'],              /* רביעי */
    ['2026-10-09T10:00:00+03:00', 'פרשת בראשית', 'כ״ט בתשרי תשפ״ז'],          /* שישי → מחר */
    ['2026-10-10T09:00:00+03:00', 'פרשת נח', 'ו׳ בחשוון תשפ״ז'],              /* שבת בבוקר → השבת הבאה */
    ['2026-10-10T21:30:00+03:00', 'פרשת נח', 'ו׳ בחשוון תשפ״ז'],              /* מוצאי שבת */
    ['2026-09-22T10:00:00+03:00', 'סוכות', 'ט״ו בתשרי תשפ״ז'],                /* שבת שחלה בחג — בלי "פרשת" */
    ['2026-10-14T10:00:00+13:00', 'פרשת נח', 'ו׳ בחשוון תשפ״ז', 'Pacific/Auckland'],      /* אזור זמן מעל UTC+12 */
    ['2026-10-09T23:30:00-07:00', 'פרשת בראשית', 'כ״ט בתשרי תשפ״ז', 'America/Los_Angeles'] /* שישי בלילה, מערבית ל-UTC */
  ]) {
    const page = await open({ clock: new Date(now), tz });
    const d = await app(page, () => ({ p: __qa.app().d.parasha, h: __qa.app().d.hdate, meta: document.querySelector('#poster .p-meta').innerText }));
    check(d.p === par && d.h === hd, `${now}${tz ? ' ' + tz : ''}: צפוי ${par} / ${hd}, התקבל ${d.p} / ${d.h}`);
    check(d.meta.includes(hd), 'התאריך אינו מוצג בלוח');
    out.push(`${now.slice(0, 16)}${tz ? ' ' + tz.split('/')[1] : ''} → ${d.p}`);
  }
  /* ערך שמור אינו נדרס בטעינה; כפתור "עדכן לשבת הקרובה" מעדכן אותו */
  const page = await open({ clock: new Date('2026-10-14T10:00:00+03:00'), seed: { parasha: 'פרשת וירא', hdate: 'ישן' } });
  check(await app(page, () => __qa.app().d.parasha) === 'פרשת וירא', 'ערך שמור נדרס בטעינה');
  await page.locator('.tab', { hasText: 'כותרת ופרטים' }).click();
  await page.locator('button', { hasText: 'עדכן לשבת הקרובה' }).click();
  await settle(200);
  const d = await app(page, () => [__qa.app().d.parasha, __qa.app().d.hdate]);
  check(d[0] === 'פרשת נח' && d[1] === 'ו׳ בחשוון תשפ״ז', 'הכפתור עדכן ל: ' + d.join(' / '));
  check(cur.requests.length === 0, 'בקשות רשת: ' + cur.requests.join(','));
  return out.join(', ');
});

test('photo.upload', 'העלאת תמונה משלך: מוצגת בלוח ובתמונה המיוצאת, נשמרת, וחזרה לברירת המחדל עובדת', ['R2', 'R21'], async () => {
  const page = await open({ dpr: 1 });
  /* תמונת בדיקה: אדום למעלה, ירוק למטה, 600×800 — נוצרת בדפדפן */
  const png = await app(page, () => { const c = document.createElement('canvas'); c.width = 600; c.height = 800; const g = c.getContext('2d'); g.fillStyle = '#d01010'; g.fillRect(0, 0, 600, 400); g.fillStyle = '#10a020'; g.fillRect(0, 400, 600, 400); return c.toDataURL('image/png'); });
  const f = path.join(OUT, 'upload-test.png');
  fs.writeFileSync(f, Buffer.from(png.split(',')[1], 'base64'));
  await page.locator('.tab', { hasText: 'עיצוב ותמונה' }).click();
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('button', { hasText: 'העלה תמונה משלך' }).click()]);
  await fc.setFiles(f);
  await page.waitForFunction(() => !!__qa.app().d.photo, null, { timeout: 8000 }).catch(() => {});
  const st = await app(page, () => ({ photo: (__qa.app().d.photo || '').slice(0, 30), len: (__qa.app().d.photo || '').length, bg: getComputedStyle(document.querySelector('#poster .p-portrait')).backgroundImage.slice(0, 40) }));
  check(st.photo.startsWith('data:image/'), 'התמונה לא נטענה לנתונים: ' + JSON.stringify(st));
  check(st.bg.includes('data:image/'), 'הלוח אינו מציג את התמונה החדשה');
  /* בייצוא: החלק העליון של הדיוקן אדום והתחתון ירוק */
  await exportCanvas(page);
  const file = await saveCanvas(page, 'photo-upload-export.png');
  const px = await app(page, () => { const r = __qa.relRect(document.querySelector('#poster .p-portrait')); const I = __qa.canvasData(window.__qaCanvas); return [__qa.px(I, (r.x + r.w / 2) * 1.5, (r.y + r.h * 0.3) * 1.5), __qa.px(I, (r.x + r.w / 2) * 1.5, (r.y + r.h * 0.8) * 1.5)]; });
  check(px[0][0] > 150 && px[0][1] < 80 && px[1][1] > 120 && px[1][0] < 80, 'התמונה המיוצאת אינה מציגה את התמונה שהועלתה: ' + JSON.stringify(px) + ' → ' + file);
  await settle(500);
  await load(page, true);
  check(await app(page, () => (__qa.app().d.photo || '').startsWith('data:image/')), 'התמונה לא נשמרה אחרי טעינה מחדש');
  await page.locator('.tab', { hasText: 'עיצוב ותמונה' }).click();
  await page.locator('button', { hasText: 'חזרה לתמונת ברירת המחדל' }).click();
  await settle(200);
  check(await app(page, () => __qa.app().d.photo === null), 'החזרה לברירת המחדל לא עבדה');
  /* קובץ שאינו תמונה נדחה בלי שגיאה */
  const txt = path.join(OUT, 'not-image.txt'); fs.writeFileSync(txt, 'hello');
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.locator('button', { hasText: 'העלה תמונה משלך' }).click()]);
  await fc2.setFiles(txt);
  await settle(500);
  check(await app(page, () => __qa.app().d.photo === null), 'קובץ טקסט התקבל כתמונה');
  return `נשמר כ-data URI (${Math.round(st.len / 1024)}KB)`;
});

/* ---------- שמירה ---------- */
test('persist.reload', 'שמירה: עריכה → טעינה מחדש → הערכים נשמרו', ['R21'], async () => {
  const page = await open({ mobile: true });
  await tapEl(page, page.locator('.tab', { hasText: 'כותרת ופרטים' }));
  const syn = page.locator('input[x-model="d.synagogue"]');
  await tapEl(page, syn);
  await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace');
  await page.keyboard.type('בית כנסת אוהל משה');
  await tapEl(page, page.locator('.tab', { hasText: 'עיצוב ותמונה' }));
  await tapEl(page, page.locator('.tdot').nth(2));
  await tapEl(page, page.locator('.seg button', { hasText: 'שתי עמודות' }));
  await tapEl(page, page.locator('.tab', { hasText: 'זמני התפילות' }));
  await tapEl(page, page.locator('.group').first().locator('.item').first().locator('label.sw'));
  await settle(700);
  const want = await app(page, () => JSON.stringify(__qa.app().d));
  const stored = await app(page, (k) => localStorage.getItem(k), STORE);
  check(stored === want, 'הנתונים לא נשמרו ב-' + STORE);
  await load(page, true);
  const got = await app(page, () => ({ d: JSON.stringify(__qa.app().d), title: document.querySelector('#poster .p-title').textContent, theme: __qa.app().d.theme, layout: __qa.app().d.layout, en: __qa.app().d.sections[0].items[0].enabled }));
  check(got.d === want, 'הנתונים אחרי טעינה שונים מלפני');
  check(got.title === 'בית כנסת אוהל משה' && got.layout === 'grid' && got.en === true, 'ערכים לא נשמרו: ' + JSON.stringify(got).slice(0, 200));
  return `${got.title}, ${got.theme}, ${got.layout}`;
});

test('persist.old-format', 'נתונים שמורים בפורמט ישן (הגרסה הראשונה) נטענים, מוצגים ומיוצאים', ['R21'], async () => {
  /* הפורמט של defaults() בגרסה cc91694 — בלי notes/notesTitle/showAddress */
  const old = {
    synagogue: 'בית כנסת יחזקאל', subtitle: 'ע"ש הבן איש חי זיע"א', address: 'רח’ ______ , ______', parasha: 'פרשת וירא',
    hdate: 'י״ח בחשוון תשפ״ז', extraMeta: '', banner: '', blessing: 'שבת שלום ומבורך', dedication: '', showPhoto: true, showBsd: true,
    photo: null, theme: 'emerald', layout: 'list',
    sections: [
      { id: 'a1', title: 'ערב שבת קודש', enabled: true, items: [{ id: 'b1', label: 'מנחה ערב שבת', time: '17:10', note: '', enabled: true, freeText: false }] },
      { id: 'a2', title: 'שבת קודש', enabled: true, items: [{ id: 'b2', label: 'שחרית', time: '08:00', note: 'בהיכל', enabled: true }, { id: 'b3', label: 'מנחה', time: 'לפני השקיעה', enabled: true, freeText: true }] }
    ]
  };
  const page = await open({ seed: old, dpr: 1.5 });
  const st = await app(page, () => ({ d: __qa.app().d, text: document.getElementById('poster').innerText, rows: document.querySelectorAll('#poster .p-row').length }));
  check(st.rows === 3, 'מספר השורות בלוח: ' + st.rows);
  check(st.text.includes('17:10') && st.text.includes('לפני השקיעה') && st.text.includes('בהיכל'), 'הזמנים הישנים אינם מוצגים');
  check(st.d.parasha === 'פרשת וירא' && st.d.theme === 'emerald', 'ערכים ישנים נדרסו');
  check(st.d.address === '', 'הכתובת לדוגמה הישנה לא נוקתה: ' + st.d.address);
  check(st.d.notesTitle === 'הודעות' && st.d.notes === '' && st.d.showAddress === true, 'שדות חדשים לא קיבלו ברירת מחדל');
  const e = await exportCanvas(page);
  check(e.w === 1080, 'הייצוא נכשל');
  /* גם נתונים פגומים לא מפילים את העמוד */
  const bad = await open({ seed: '{"sections":[{"title":"x"' });
  check(await app(bad, () => document.querySelectorAll('#poster .p-row').length) > 0, 'נתונים פגומים השאירו לוח ריק');
  if (st.text.includes('ע"ש הבן איש חי')) warn('נטען ומוצג תקין; אך כותרת המשנה הישנה "ע"ש הבן איש חי זיע"א" שנשמרה במכשירי משתמשים קיימים ממשיכה להופיע בלוח (אין הגירה), בניגוד לדרישה 2');
});

/* ---------- שיתוף ---------- */
const BRIDGE = () => {
  window.__qaBridge = [];
  window.AndroidBridge = {
    shareImage: (d, t) => { window.__qaBridge.push({ fn: 'shareImage', d, t }); },
    saveImage: (d, n) => { window.__qaBridge.push({ fn: 'saveImage', d, n }); return true; },
    shareText: (t, n) => { window.__qaBridge.push({ fn: 'shareText', t, n }); },
    appVersion: () => '9.9.9', checkUpdate: (q) => { window.__qaBridge.push({ fn: 'checkUpdate', q }); }, installUpdate: () => { window.__qaBridge.push({ fn: 'installUpdate' }); }
  };
};
test('share.android', 'אנדרואיד: שיתוף שולח PNG בלבד בלי טקסט; הורדה שומרת PNG; גיבוי עובר כטקסט', ['R9', 'כלל 6'], async () => {
  const page = await open({ mobile: true, init: [BRIDGE] });
  await tapEl(page, page.locator('.topbar .btn-wa'));
  await page.waitForFunction(() => window.__qaBridge.some(c => c.fn === 'shareImage'), null, { timeout: 15000 });
  const sh = await app(page, async () => {
    const c = window.__qaBridge.filter(c => c.fn === 'shareImage');
    const I = await __qa.imgData(c[0].d);
    return { count: c.length, prefix: c[0].d.slice(0, 22), text: c[0].t, w: I.w, h: I.h, poster: parseFloat(getComputedStyle(document.getElementById('poster')).height) * 1.5 };
  });
  check(sh.count === 1, 'shareImage נקרא ' + sh.count + ' פעמים');
  check(sh.prefix === 'data:image/png;base64,', 'לא PNG: ' + sh.prefix);
  check(sh.text === '' || sh.text === undefined || sh.text === null, 'נשלח טקסט עם התמונה: "' + sh.text + '"');
  check(sh.w === 1080 && Math.abs(sh.h - sh.poster) <= 1, `ממדי התמונה המשותפת ${sh.w}×${sh.h} (לוח ×1.5: ${sh.poster})`);
  await tapEl(page, page.locator('.topbar .btn', { hasText: 'הורדה' }));
  await page.waitForFunction(() => window.__qaBridge.some(c => c.fn === 'saveImage'), null, { timeout: 15000 });
  const sv = await app(page, () => window.__qaBridge.filter(c => c.fn === 'saveImage').map(c => ({ p: c.d.slice(0, 22), n: c.n })));
  check(sv.length === 1 && sv[0].p === 'data:image/png;base64,' && /\.png$/.test(sv[0].n), 'saveImage: ' + JSON.stringify(sv));
  await tapEl(page, page.locator('.tab', { hasText: 'עיצוב ותמונה' }));
  await tapEl(page, page.locator('button', { hasText: 'גיבוי לקובץ' }));
  await settle(400);
  const tx = await app(page, () => window.__qaBridge.filter(c => c.fn === 'shareText'));
  check(tx.length === 1 && /\.json$/.test(tx[0].n) && JSON.parse(tx[0].t).sections, 'גיבוי באנדרואיד: ' + JSON.stringify(tx).slice(0, 100));
  check(await app(page, () => __qa.app().appVersion) === '9.9.9', 'גרסת האפליקציה לא נקראה מהגשר');
  /* window.__update מציג פס עדכון */
  await app(page, () => window.__update('available', '1.0.99', 0, false)); await settle(300);
  check(await app(page, () => { const u = document.querySelector('.upd'); return u.offsetParent !== null && u.innerText.includes('1.0.99'); }), 'פס העדכון לא הוצג');
  return `PNG ${sh.w}×${sh.h}, טקסט: ${JSON.stringify(sh.text)}, קובץ: ${sv[0].n}`;
});

test('share.web', 'דפדפן: navigator.share מקבל קובץ PNG בלבד, בלי text/title/url', ['R9'], async () => {
  const page = await open({ mobile: true, init: [() => {
    window.__qaShare = [];
    navigator.canShare = (d) => !!(d && d.files);
    navigator.share = async (d) => { window.__qaShare.push({ keys: Object.keys(d), files: (d.files || []).map(f => ({ n: f.name, t: f.type, s: f.size })), text: d.text, title: d.title, url: d.url }); };
  }] });
  await tapEl(page, page.locator('.topbar .btn-wa'));
  await page.waitForFunction(() => window.__qaShare.length > 0, null, { timeout: 15000 });
  const s = await app(page, () => window.__qaShare);
  check(s.length === 1, 'share נקרא ' + s.length + ' פעמים');
  check(JSON.stringify(s[0].keys) === '["files"]', 'שדות שנשלחו ל-share: ' + s[0].keys.join(','));
  check(s[0].files.length === 1 && s[0].files[0].t === 'image/png' && s[0].files[0].s > 10000, 'הקובץ: ' + JSON.stringify(s[0].files));
  return `${s[0].files[0].n} (${Math.round(s[0].files[0].s / 1024)}KB)`;
});

test('share.web-fallback', 'דפדפן בלי Web Share: התמונה יורדת כ-PNG ונפתח וואטסאפ ווב', ['R9'], async () => {
  const page = await open({ init: [() => { window.__qaOpen = []; navigator.canShare = undefined; window.open = (u) => { window.__qaOpen.push(u); return null; }; }] });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.locator('.topbar .btn-wa').click()]);
  const f = path.join(OUT, 'share-fallback.png');
  await dl.saveAs(f);
  const head = fs.readFileSync(f).subarray(0, 24);
  check(head.subarray(1, 4).toString() === 'PNG', 'הקובץ שירד אינו PNG');
  const w = head.readUInt32BE(16), h = head.readUInt32BE(20);
  check(w === 1080, 'רוחב ' + w);
  await settle(300);
  const opened = await app(page, () => window.__qaOpen);
  check(opened.length === 1 && /whatsapp/.test(opened[0]), 'וואטסאפ לא נפתח: ' + opened);
  return `${dl.suggestedFilename()} ${w}×${h}`;
});

test('backup.roundtrip', 'גיבוי לקובץ JSON ושחזור ממנו מחזירים את כל הנתונים; קובץ פגום אינו משנה דבר', ['R21'], async () => {
  const page = await open();
  await setData(page, { synagogue: 'בית כנסת לגיבוי', notes: 'הודעה\nשנייה', banner: 'רצועה', theme: 'night', layout: 'grid' });
  await settle(300);
  await page.locator('.tab', { hasText: 'עיצוב ותמונה' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText: 'גיבוי לקובץ' }).click()]);
  const f = path.join(OUT, 'backup.json');
  await dl.saveAs(f);
  const orig = await app(page, () => JSON.stringify(__qa.app().d));
  check(JSON.stringify(JSON.parse(fs.readFileSync(f, 'utf8'))) === orig, 'קובץ הגיבוי אינו זהה לנתונים');
  await app(page, () => { const d = __qa.app().d; d.synagogue = 'שונה'; d.sections.splice(0, 2); d.theme = 'royal'; });
  await settle(200);
  const accept = await page.locator('input[type=file][x-ref=json]').getAttribute('accept');
  check(/\.json/.test(accept || ''), 'בורר הקבצים אינו מקבל סיומת ‎.json‎ (באנדרואיד קבצי JSON מסומנים לעיתים octet-stream): ' + accept);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('button', { hasText: 'שחזור מגיבוי' }).click()]);
  await fc.setFiles(f);
  await page.waitForFunction(() => __qa.app().d.synagogue === 'בית כנסת לגיבוי', null, { timeout: 5000 });
  check(await app(page, () => JSON.stringify(__qa.app().d)) === orig, 'השחזור אינו זהה למקור');
  check(await app(page, () => document.querySelector('#poster .p-title').textContent) === 'בית כנסת לגיבוי', 'הלוח לא עודכן אחרי שחזור');
  const badF = path.join(OUT, 'backup-bad.json');
  fs.writeFileSync(badF, '{ not json');
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.locator('button', { hasText: 'שחזור מגיבוי' }).click()]);
  await fc2.setFiles(badF);
  await settle(500);
  check(await app(page, () => JSON.stringify(__qa.app().d)) === orig, 'קובץ פגום שינה את הנתונים');
  check(await app(page, () => __qa.app().toastMsg) === 'הקובץ אינו תקין', 'לא הוצגה הודעה על קובץ פגום');
  return path.relative(ROOT, f);
});

/* חייבת להיות האחרונה */
test('zz.no-native-dialogs', 'לאורך כל החבילה לא נקרא alert/confirm/prompt ולא נפתח חלון מערכת', ['כלל 5', 'R12'], async () => {
  check(suiteDialogs.length === 0, suiteDialogs.join(' | '));
  return 'נבדקו כל הדפים בחבילה';
});

/* ======================================================================
   הרצה
   ====================================================================== */
browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const selected = tests.filter(t => !FILTERS.length || FILTERS.some(f => t.id.includes(f)) || t.id.startsWith('zz.'));
const results = [];
const t0 = Date.now();
for (const t of selected) {
  cur = { contexts: [], pages: [], errors: [], dialogs: [], requests: [] };
  const start = Date.now();
  let status = 'PASS', msg = '';
  try {
    const r = await Promise.race([t.fn(), sleep(t.opts.timeout || 90000).then(() => fail('חריגת זמן'))]);
    msg = r || '';
  } catch (e) {
    if (e instanceof Warn) { status = 'WARN'; msg = e.message; }
    else { status = 'FAIL'; msg = (e && e.message || String(e)).split('\n')[0]; }
  }
  /* קריאות לחלונות מערכת מכל הדפים */
  for (const p of cur.pages) {
    try { if (!p.isClosed()) cur.dialogs.push(...await p.evaluate(() => (window.__qa && window.__qa.dialogs) || [])); } catch (e) {}
  }
  suiteDialogs.push(...cur.dialogs.map(d => t.id + ': ' + d));
  if (status !== 'FAIL') {
    if (cur.errors.length) { status = 'FAIL'; msg = 'שגיאות בעמוד: ' + [...new Set(cur.errors)].slice(0, 3).join(' | ') + (msg ? ' || ' + msg : ''); }
    else if (cur.dialogs.length) { status = 'FAIL'; msg = 'חלון מערכת: ' + cur.dialogs.join(' | '); }
    else if (cur.requests.length) { status = 'FAIL'; msg = 'בקשות רשת: ' + cur.requests.join(', '); }
  }
  for (const c of cur.contexts) await c.close().catch(() => {});
  const ms = Date.now() - start;
  results.push({ id: t.id, title: t.title, reqs: t.reqs, status, msg, ms });
  const mark = status === 'PASS' ? '\x1b[32mPASS\x1b[0m' : status === 'WARN' ? '\x1b[33mWARN\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${mark} ${t.id} — ${t.title} (${ms} ms)${msg ? '\n     ' + msg : ''}`);
}
await browser.close();
const n = (s) => results.filter(r => r.status === s).length;
console.log(`\nסיכום: ${n('PASS')} עברו, ${n('WARN')} עם אזהרה, ${n('FAIL')} נכשלו, מתוך ${results.length} (${Math.round((Date.now() - t0) / 1000)} שניות)`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
process.exit(n('FAIL') ? 1 : 0);
