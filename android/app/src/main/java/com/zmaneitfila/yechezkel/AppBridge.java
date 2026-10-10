package com.zmaneitfila.yechezkel;

import android.annotation.TargetApi;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.atomic.AtomicBoolean;

/** הגשר בין העמוד לאנדרואיד: שיתוף התמונה, שמירתה בגלריה ושיתוף קובץ הגיבוי. */
public class AppBridge {

    private final Activity act;

    AppBridge(Activity act) { this.act = act; }

    /** שיתוף לוח הזמנים כתמונה — נפתח בורר האפליקציות של המכשיר. */
    @JavascriptInterface
    public void shareImage(final String dataUrl, final String text) {
        act.runOnUiThread(() -> {
            try {
                File file = writeToCache(decode(dataUrl), "zmanei-tfila.png");
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType("image/png");
                intent.putExtra(Intent.EXTRA_STREAM, uriFor(file));
                if (text != null && !text.isEmpty()) intent.putExtra(Intent.EXTRA_TEXT, text);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                act.startActivity(Intent.createChooser(intent, act.getString(R.string.share_title)));
            } catch (Exception e) {
                toast("לא הצלחתי לשתף את התמונה");
            }
        });
    }

    /** שמירת התמונה במכשיר. מחזיר false כשהשמירה אינה אפשרית, ואז העמוד יציע שיתוף. */
    @JavascriptInterface
    public boolean saveImage(final String dataUrl, final String name) {
        try {
            byte[] png = decode(dataUrl);
            String fileName = safeName(name, ".png");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                if (!saveToGallery(png, fileName)) return false;
                act.runOnUiThread(() -> toast("התמונה נשמרה בגלריה"));
                return true;
            }
            return saveToAppPictures(png, fileName);
        } catch (Exception e) {
            return false;
        }
    }

    /** אנדרואיד 10 ומעלה: לתיקייה Pictures/זמני תפילה דרך MediaStore, בלי שום הרשאה. */
    @TargetApi(Build.VERSION_CODES.Q)
    private boolean saveToGallery(byte[] png, String fileName) {
        ContentResolver cr = act.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
        values.put(MediaStore.Images.Media.RELATIVE_PATH,
                Environment.DIRECTORY_PICTURES + "/זמני תפילה");
        values.put(MediaStore.Images.Media.IS_PENDING, 1);   /* מוסתרת עד שהכתיבה מסתיימת */
        Uri uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) return false;
        try (OutputStream out = cr.openOutputStream(uri)) {
            if (out == null) throw new Exception("no output stream");
            out.write(png);
        } catch (Exception e) {
            cr.delete(uri, null, null);                       /* לא משאירים בגלריה רשומה ריקה */
            return false;
        }
        ContentValues ready = new ContentValues();
        ready.put(MediaStore.Images.Media.IS_PENDING, 0);
        cr.update(uri, ready, null, null);
        return true;
    }

    /** אנדרואיד 8–9: RELATIVE_PATH אינו קיים שם, וכתיבה לתיקייה ציבורית מחייבת הרשאת
     *  אחסון שהאפליקציה אינה מבקשת. לכן שומרים בתיקיית התמונות של האפליקציה, שאינה
     *  דורשת הרשאה, ומבקשים מסורק המדיה לרשום את הקובץ כדי שיופיע בגלריה. */
    private boolean saveToAppPictures(byte[] png, String fileName) throws Exception {
        File base = act.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (base == null) return false;                       /* אחסון חיצוני אינו זמין */
        File dir = new File(base, "זמני תפילה");
        if (!dir.exists() && !dir.mkdirs()) return false;
        File file = new File(dir, fileName);
        try (FileOutputStream out = new FileOutputStream(file)) { out.write(png); }
        MediaScannerConnection.scanFile(act, new String[] { file.getAbsolutePath() },
                new String[] { "image/png" }, null);
        return true;
    }

    /** שיתוף קובץ הגיבוי של ההגדרות. */
    @JavascriptInterface
    public void shareText(final String content, final String name) {
        act.runOnUiThread(() -> {
            try {
                File file = writeToCache(content.getBytes("UTF-8"), safeName(name, ".json"));
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_STREAM, uriFor(file));
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                act.startActivity(Intent.createChooser(intent, act.getString(R.string.share_title)));
            } catch (Exception e) {
                toast("לא הצלחתי לשתף את הקובץ");
            }
        });
    }

    /** גרסת האפליקציה המותקנת, להצגה בפאנל הניהול. */
    @JavascriptInterface
    public String appVersion() {
        try {
            PackageInfo info = act.getPackageManager().getPackageInfo(act.getPackageName(), 0);
            return info.versionName + " (" + PackageInfoCompat.getLongVersionCode(info) + ")";
        } catch (Exception e) {
            return "";
        }
    }

    /* ====== עדכון האפליקציה מתוך האפליקציה ====== */

    private static final String RELEASE_API =
            "https://api.github.com/repos/havivon/zmaneitfila/releases/latest";

    /** בודק אם פורסמה גרסה חדשה. התשובה חוזרת לעמוד דרך window.__update. */
    @JavascriptInterface
    public void checkUpdate(final boolean quiet) {
        new Thread(() -> {
            try {
                JSONObject release = new JSONObject(fetch(RELEASE_API));
                String version = release.optString("tag_name", "");
                String url = "";
                JSONArray assets = release.optJSONArray("assets");
                for (int i = 0; assets != null && i < assets.length(); i++) {
                    JSONObject asset = assets.getJSONObject(i);
                    if (asset.optString("name", "").endsWith(".apk")) {
                        url = asset.optString("browser_download_url", "");
                        break;
                    }
                }
                if (version.isEmpty() || url.isEmpty()) { report("error", "", 0, quiet); return; }
                /* נשמר לפני הדיווח, כדי שלחיצה מהירה על "עדכן עכשיו" תמצא את הכתובת */
                pendingUrl = url;
                pendingVersion = version;
                report(isNewer(version) ? "available" : "latest", version, 0, quiet);
            } catch (Exception e) {
                report("error", "", 0, quiet);
            }
        }).start();
    }

    /** מוריד את הגרסה שנמצאה ופותח את מתקין החבילות. */
    @JavascriptInterface
    public void installUpdate() {
        final String url = pendingUrl, version = pendingVersion;
        if (url == null || url.isEmpty()) return;
        /* הורדה אחת בכל פעם: שתי הורדות במקביל כותבות לאותו קובץ ומוחקות זו לזו */
        if (!downloading.compareAndSet(false, true)) return;
        new Thread(() -> {
            try {
                File dir = new File(act.getCacheDir(), "updates");
                if (dir.exists()) {
                    File[] stale = dir.listFiles();
                    if (stale != null) for (File old : stale) old.delete();
                } else {
                    dir.mkdirs();
                }
                File apk = new File(dir, "zmanei-tfila-" + version.replaceAll("[^0-9A-Za-z.]", "") + ".apk");

                HttpURLConnection conn = open(url);
                int total = conn.getContentLength();
                try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[16384];
                    int read, done = 0, lastPct = -1;
                    while ((read = in.read(buf)) != -1) {
                        out.write(buf, 0, read);
                        done += read;
                        int pct = total > 0 ? (int) (100L * done / total) : 0;
                        if (pct != lastPct) { lastPct = pct; report("progress", version, pct, false); }
                    }
                    /* חיבור שנקטע באמצע מסתיים לפעמים בלי שגיאה; קובץ חלקי לא יועבר למתקין */
                    if (total > 0 && done != total) throw new Exception("incomplete download");
                }
                conn.disconnect();

                report("installing", version, 100, false);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uriFor(apk), "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                act.startActivity(intent);
            } catch (Exception e) {
                report("error", version, 0, false);
            } finally {
                downloading.set(false);
            }
        }).start();
    }

    /* נכתבים בתהליכון הבדיקה ונקראים בתהליכון הגשר — volatile כדי שהערך ייראה */
    private volatile String pendingUrl = "", pendingVersion = "";
    private final AtomicBoolean downloading = new AtomicBoolean(false);

    private boolean isNewer(String remote) {
        try {
            String local = act.getPackageManager()
                    .getPackageInfo(act.getPackageName(), 0).versionName;
            String[] a = remote.replaceAll("[^0-9.]", "").split("\\.");
            String[] b = local.replaceAll("[^0-9.]", "").split("\\.");
            for (int i = 0; i < Math.max(a.length, b.length); i++) {
                int x = i < a.length ? Integer.parseInt(a[i]) : 0;
                int y = i < b.length ? Integer.parseInt(b[i]) : 0;
                if (x != y) return x > y;
            }
            return false;
        } catch (Exception e) { return false; }
    }

    private HttpURLConnection open(String url) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(12000);
        conn.setReadTimeout(20000);
        conn.setRequestProperty("Accept", "application/vnd.github+json");
        conn.setRequestProperty("User-Agent", "zmanei-tfila-app");
        return conn;
    }

    private String fetch(String url) throws Exception {
        HttpURLConnection conn = open(url);
        StringBuilder sb = new StringBuilder();
        try (InputStream in = conn.getInputStream()) {
            byte[] buf = new byte[8192];
            int read;
            while ((read = in.read(buf)) != -1) sb.append(new String(buf, 0, read, "UTF-8"));
        }
        conn.disconnect();
        return sb.toString();
    }

    private void report(String state, String version, int percent, boolean quiet) {
        String safe = version.replaceAll("[^0-9A-Za-z.\\-]", "");
        ((MainActivity) act).postToWeb(
                "window.__update && window.__update('" + state + "','" + safe + "'," + percent + "," + quiet + ")");
    }

    private static byte[] decode(String dataUrl) {
        int comma = dataUrl.indexOf(',');
        return Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
    }

    private File writeToCache(byte[] bytes, String name) throws Exception {
        File dir = new File(act.getCacheDir(), "shared");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("mkdirs failed");
        File file = new File(dir, name);
        try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
        return file;
    }

    private Uri uriFor(File file) {
        return FileProvider.getUriForFile(act, act.getPackageName() + ".fileprovider", file);
    }

    private static String safeName(String name, String fallbackExt) {
        String clean = (name == null ? "" : name).replaceAll("[\\\\/:*?\"<>|]", "").trim();
        if (clean.isEmpty()) clean = "zmanei-tfila" + fallbackExt;
        return clean;
    }

    private void toast(String msg) {
        Toast.makeText(act, msg, Toast.LENGTH_SHORT).show();
    }
}
