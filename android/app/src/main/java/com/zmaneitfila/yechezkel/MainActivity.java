package com.zmaneitfila.yechezkel;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** עטיפה דקה ל‑WebView שמריץ את לוח זמני התפילות מתוך נכסי האפליקציה. */
public class MainActivity extends Activity {

    private static final int FILE_CHOOSER_REQUEST = 1001;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          /* שמירת ההגדרות במכשיר */
        /* העמוד נטען מ‑file:///android_asset, שאינו תלוי בהגדרה זו. גישה לשאר
           קבצי המכשיר אינה נחוצה, ולכן חסומה (זו גם ברירת המחדל מאנדרואיד 11). */
        s.setAllowFileAccess(false);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);

        /* לחיצה ארוכה בעמוד מיועדת לגרירת שורות, ולכן מחוות בחירת הטקסט
           של ה‑WebView מנוטרלת. עריכה והקלדה אינן מושפעות. */
        web.setLongClickable(false);
        web.setHapticFeedbackEnabled(false);
        web.setOnLongClickListener(v -> true);

        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    startActivityForResult(chooserIntent(params), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
            }
        });

        web.addJavascriptInterface(new AppBridge(this), "AndroidBridge");
        web.loadUrl("file:///android_asset/index.html");
        setContentView(web);
    }

    /** בורר תמונות נשאר לתמונות בלבד. לכל בורר אחר (קובץ הגיבוי) — כל הקבצים:
     *  createIntent לוקח רק את סוג ה‑accept הראשון, ובורר שמסנן application/json
     *  מאפיר קובצי .json שהמכשיר מדווח עליהם כ‑application/octet-stream.
     *  תוכן הקובץ נבדק ממילא בעמוד לפני השחזור. */
    private static Intent chooserIntent(WebChromeClient.FileChooserParams params) {
        String[] types = params.getAcceptTypes();
        boolean imagesOnly = types != null && types.length > 0;
        if (types != null) for (String t : types) {
            if (t == null || !t.trim().startsWith("image/")) { imagesOnly = false; break; }
        }
        if (imagesOnly) return params.createIntent();
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        return intent;
    }

    /** מאפשר לצד האנדרואיד לדווח לעמוד על מצב העדכון. */
    void postToWeb(final String js) {
        runOnUiThread(() -> {
            if (web != null) web.evaluateJavascript(js, null);
        });
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == FILE_CHOOSER_REQUEST) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(result, data));
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(request, result, data);
    }

    /** מקש "חזרה" סוגר חלון פתוח בעמוד לפני שהוא סוגר את האפליקציה. */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript(
                "(function(){ if (window.__closeTopLayer) return window.__closeTopLayer(); return false; })()",
                value -> { if (!"true".equals(value)) finish(); });
    }
}
