#!/usr/bin/env bash
# מכין את נכסי האפליקציה: מעתיק את העמוד ומפנה אותו לספריות ולגופנים המקומיים,
# כך שהאפליקציה עובדת גם בלי חיבור לאינטרנט.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$ROOT" <<'PY'
import sys, pathlib
root = pathlib.Path(sys.argv[1])
src = (root / 'index.html').read_text(encoding='utf-8')
subs = [
 ('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', 'vendor/html2canvas.min.js'),
 ('https://cdnjs.cloudflare.com/ajax/libs/alpinejs/3.13.3/cdn.min.js', 'vendor/alpine.min.js'),
 ('<link rel="preconnect" href="https://fonts.googleapis.com">\n', ''),
 ('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n', ''),
 ('<link href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@400;500;700;900&family=Heebo:wght@300;400;500;700;900&display=swap" rel="stylesheet">',
  '<link rel="stylesheet" href="fonts.css">'),
]
for old, new in subs:
    if old not in src:
        raise SystemExit('prepare-assets: לא נמצא הדפוס להחלפה:\n  ' + old[:90])
    src = src.replace(old, new)
out = root / 'android' / 'app' / 'src' / 'main' / 'assets' / 'index.html'
out.write_text(src, encoding='utf-8')
print('assets/index.html נכתב (%d KB)' % (len(src.encode('utf-8')) // 1024))
PY
