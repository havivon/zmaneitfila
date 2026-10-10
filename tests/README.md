# בדיקות קצה-לקצה

חבילת בדיקות אוטומטית (Playwright) לדרישות בעל הפרויקט ולרשימת "בדיקה לפני מסירה" שב‑`AGENTS.md`.
החבילה מריצה בעצמה את `android/prepare-assets.sh` וטוענת את
`android/app/src/main/assets/index.html` (שכל התלויות בו מקומיות), כך שאין צורך ברשת.

## הרצה

```
cd tests
npm install                 # פעם אחת: מתקין את playwright-core (בלי דפדפנים)
node e2e.mjs                # כל הבדיקות
node e2e.mjs drag export    # רק בדיקות שהמזהה שלהן מכיל את המחרוזות
```

- `CHROMIUM_PATH` — נתיב לכרום/כרומיום (ברירת מחדל: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`).
- `SKIP_PREPARE=1` — לא להריץ את `prepare-assets.sh` (בדיקת הסנכרון תיכשל במקרה זה).
- `QA_PAGE=<נתיב>` — להריץ מול קובץ HTML אחר, למשל גרסה קודמת לבקרה (צריך לצדו `vendor/` ו‑`fonts.css`).

כל בדיקה רצה בהקשר דפדפן חדש עם `localStorage` ריק. לכל בדיקה מודפסת שורת
PASS / WARN / FAIL עם סיבה קצרה, ובסוף סיכום. קוד היציאה שונה מאפס אם בדיקה כלשהי נכשלה.
בכל דף נרשמות קריאות ל‑`alert/confirm/prompt`, שגיאות קונסול ובקשות רשת — כל אחת מהן מכשילה את הבדיקה.

תמונות הייצוא, חיתוכי ההשוואה (חי | ייצוא) ו‑`results.json` נשמרים ב‑`tests/out/` (מוחרג מ‑git).
`qa-lib.js` מוזרק לכל דף ומכיל את כלי ניתוח הפיקסלים.
