package com.zmaneitfila.yechezkel;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

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

    /** שמירת התמונה בגלריה. מחזיר false כשהשמירה אינה אפשרית, ואז העמוד יציע שיתוף. */
    @JavascriptInterface
    public boolean saveImage(final String dataUrl, final String name) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false;
        try {
            byte[] png = decode(dataUrl);
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, safeName(name, ".png"));
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            values.put(MediaStore.Images.Media.RELATIVE_PATH,
                    Environment.DIRECTORY_PICTURES + "/זמני תפילה");
            Uri uri = act.getContentResolver()
                    .insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) return false;
            try (OutputStream out = act.getContentResolver().openOutputStream(uri)) {
                if (out == null) return false;
                out.write(png);
            }
            act.runOnUiThread(() -> toast("התמונה נשמרה בגלריה"));
            return true;
        } catch (Exception e) {
            return false;
        }
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
