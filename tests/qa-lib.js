/* ספריית עזר שמוזרקת לכל עמוד בבדיקות (addInitScript), לפני הסקריפטים של האפליקציה.
   - רושמת כל קריאה ל-alert/confirm/prompt (אסורות לפי AGENTS.md, כלל 5);
   - נותנת גישה לרכיב Alpine;
   - מנתחת פיקסלים של תמונות וקנבסים בתוך הדפדפן, כדי לא להזדקק לספריות PNG ב-Node. */
(() => {
  const qa = window.__qa = {
    dialogs: [],
    app() {
      const el = document.querySelector('[x-data]');
      return el && el._x_dataStack ? el._x_dataStack[0] : null;
    },
    /* תמונה (data URL / blob URL) → {w,h,data} */
    async imgData(src) {
      const im = new Image();
      im.src = src;
      await im.decode();
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(im, 0, 0);
      return { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
    },
    canvasData(c) {
      const g = c.getContext('2d');
      return { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
    },
    crop(img, x, y, w, h) {
      x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
      w = Math.min(img.w - x, Math.round(w)); h = Math.min(img.h - y, Math.round(h));
      const out = new Uint8ClampedArray(w * h * 4);
      for (let r = 0; r < h; r++) {
        const s = ((y + r) * img.w + x) * 4;
        out.set(img.data.subarray(s, s + w * 4), r * w * 4);
      }
      return { w, h, data: out };
    },
    px(img, x, y) {
      const i = (Math.round(y) * img.w + Math.round(x)) * 4;
      return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
    },
    /* צבע הרקע של חיתוך: חציון פיקסלי השורה העליונה והתחתונה */
    bgOf(img) {
      const ch = [[], [], []];
      for (const y of [0, img.h - 1]) for (let x = 0; x < img.w; x++) {
        const i = (y * img.w + x) * 4;
        ch[0].push(img.data[i]); ch[1].push(img.data[i + 1]); ch[2].push(img.data[i + 2]);
      }
      return ch.map(a => a.sort((p, q) => p - q)[a.length >> 1]);
    },
    /* פרופיל "דיו": אילו עמודות ושורות מכילות פיקסל ששונה מהרקע */
    ink(img, thr = 150, bg = null) {
      bg = bg || qa.bgOf(img);
      const cols = new Array(img.w).fill(0), rows = new Array(img.h).fill(0);
      for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
        const i = (y * img.w + x) * 4;
        const d = Math.abs(img.data[i] - bg[0]) + Math.abs(img.data[i + 1] - bg[1]) + Math.abs(img.data[i + 2] - bg[2]);
        if (d > thr) { cols[x]++; rows[y]++; }
      }
      const first = cols.findIndex(v => v > 0), last = cols.length - 1 - [...cols].reverse().findIndex(v => v > 0);
      const top = rows.findIndex(v => v > 0), bottom = rows.length - 1 - [...rows].reverse().findIndex(v => v > 0);
      const gaps = [];
      if (first >= 0) {
        let run = 0;
        for (let x = first; x <= last; x++) {
          if (cols[x] === 0) run++;
          else { if (run) gaps.push({ at: x - run - first, len: run }); run = 0; }
        }
      }
      return {
        bg, first, last, inkW: first >= 0 ? last - first + 1 : 0,
        top, bottom, inkH: top >= 0 ? bottom - top + 1 : 0,
        gaps, maxGap: gaps.reduce((m, g) => Math.max(m, g.len), 0)
      };
    },
    /* הפרש ממוצע (0..255) בין שתי תמונות באותו גודל, וחלק הפיקסלים שהפרשם גדול */
    diff(a, b, thr = 60) {
      const w = Math.min(a.w, b.w), h = Math.min(a.h, b.h);
      let sum = 0, big = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * a.w + x) * 4, j = (y * b.w + x) * 4;
        const d = Math.abs(a.data[i] - b.data[j]) + Math.abs(a.data[i + 1] - b.data[j + 1]) + Math.abs(a.data[i + 2] - b.data[j + 2]);
        sum += d; if (d > thr) big++;
      }
      return { mean: sum / (w * h * 3), frac: big / (w * h) };
    },
    /* תמונת הפרש להצגה: אדום היכן שהשתיים שונות */
    diffPng(a, b, thr = 60) {
      const w = Math.min(a.w, b.w), h = Math.min(a.h, b.h);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); const id = g.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * a.w + x) * 4, j = (y * b.w + x) * 4, k = (y * w + x) * 4;
        const d = Math.abs(a.data[i] - b.data[j]) + Math.abs(a.data[i + 1] - b.data[j + 1]) + Math.abs(a.data[i + 2] - b.data[j + 2]);
        const l = (a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3 * 0.35;
        if (d > thr) { id.data[k] = 255; id.data[k + 1] = 0; id.data[k + 2] = 0; }
        else { id.data[k] = id.data[k + 1] = id.data[k + 2] = l; }
        id.data[k + 3] = 255;
      }
      g.putImageData(id, 0, 0);
      return c.toDataURL('image/png');
    },
    /* כמה מפיקסלי הקישוט (היכן ש-a שונה מ-b) נמצאים גם ב-e: לכל פיקסל במסכה בודקים
       אם e קרוב יותר ל-a (הלוח עם הקישוט) מאשר ל-b (הלוח בלעדיו). מחפשים היסט של ±1px
       כדי שעיגול של תת-פיקסל לא ייחשב כחוסר. */
    presence(a, b, e, thr = 60) {
      const w = Math.min(a.w, b.w, e.w), h = Math.min(a.h, b.h, e.h);
      const dd = (P, i, Q, j) => Math.abs(P.data[i] - Q.data[j]) + Math.abs(P.data[i + 1] - Q.data[j + 1]) + Math.abs(P.data[i + 2] - Q.data[j + 2]);
      const mask = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = (y * a.w + x) * 4;
        if (dd(a, i, b, (y * b.w + x) * 4) > thr) mask.push([x, y]);
      }
      let best = { score: 0, dx: 0, dy: 0 };
      for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) {
        let ok = 0;
        for (const [x, y] of mask) {
          const i = (y * a.w + x) * 4, j = (y * b.w + x) * 4, k = ((y + dy) * e.w + x + dx) * 4;
          if (dd(e, k, a, i) < dd(e, k, b, j)) ok++;
        }
        const score = mask.length ? ok / mask.length : 0;
        if (score > best.score) best = { score, dx, dy };
      }
      return { mask: mask.length, ...best };
    },
    /* הצבה זו לצד זו (להשוואה חזותית), בהגדלה */
    side(imgs, scale = 1) {
      const W = imgs.reduce((s, i) => s + i.w, 0) + 6 * (imgs.length - 1), H = Math.max(...imgs.map(i => i.h));
      const c = document.createElement('canvas'); c.width = W * scale; c.height = H * scale;
      const g = c.getContext('2d'); g.fillStyle = '#f0f'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = false;
      let x = 0;
      for (const i of imgs) {
        const t = document.createElement('canvas'); t.width = i.w; t.height = i.h;
        const id = t.getContext('2d').createImageData(i.w, i.h); id.data.set(i.data); t.getContext('2d').putImageData(id, 0, 0);
        g.drawImage(t, x * scale, 0, i.w * scale, i.h * scale); x += i.w + 6;
      }
      return c.toDataURL('image/png');
    },
    toPng(img) {
      const c = document.createElement('canvas'); c.width = img.w; c.height = img.h;
      const g = c.getContext('2d'); const id = g.createImageData(img.w, img.h);
      id.data.set(img.data); g.putImageData(id, 0, 0);
      return c.toDataURL('image/png');
    },
    /* מיקום אלמנט ביחס ללוח, בפיקסלים של CSS */
    relRect(el) {
      const p = document.getElementById('poster').getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { x: r.left - p.left, y: r.top - p.top, w: r.width, h: r.height };
    }
  };
  /* חלונות מערכת אסורים — רושמים כל קריאה */
  for (const k of ['alert', 'confirm', 'prompt']) {
    window[k] = function (...a) {
      qa.dialogs.push(k + '(' + a.map(String).join(', ') + ')');
      return k === 'confirm' ? false : (k === 'prompt' ? null : undefined);
    };
  }
})();
