package org.echo.aac;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

// Offline UI shell. Voice inference is deliberately NOT claimed until a real local model is wired.
public final class MainActivity extends Activity {
    private static final String LOCAL_ORIGIN = "https://appassets.androidplatform.net";
    private static final int MIC_REQUEST_CODE = 401;
    private static final int MIC_PREFLIGHT_CODE = 402;
    private String pendingPreflightId;
    private WebView web;
    private PermissionRequest pendingMic;
    private WebViewAssetLoader assets;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        assets = new WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();
        web = new WebView(this);
        setContentView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // Keep the bridge inaccessible from all external URLs; external navigation is blocked.
        web.addJavascriptInterface(new VoiceBridge(), "EchoAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                if (!LOCAL_ORIGIN.equals(req.getUrl().getScheme() + "://" + req.getUrl().getHost()))
                    return blocked();
                WebResourceResponse local = assets.shouldInterceptRequest(req.getUrl());
                return local != null ? local : blocked();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return !LOCAL_ORIGIN.equals(req.getUrl().getScheme() + "://" + req.getUrl().getHost());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest req) {
                runOnUiThread(() -> {
                    if (!LOCAL_ORIGIN.equals(req.getOrigin().toString().replaceAll("/$", ""))) {
                        req.deny(); return;
                    }
                    if (req.getResources().length != 1 ||
                        !PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(req.getResources()[0])) {
                        req.deny(); return;
                    }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        req.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        pendingMic = req;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_REQUEST_CODE);
                    }
                });
            }
        });
        // The packaged UI is in assets/www; AssetLoader maps URL paths to assets paths.
        web.loadUrl(LOCAL_ORIGIN + "/www/index.html");
    }
    private WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked",
            java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] result) {
        super.onRequestPermissionsResult(code, permissions, result);
        if (code == MIC_PREFLIGHT_CODE && pendingPreflightId != null) {
            String id = pendingPreflightId;
            pendingPreflightId = null;
            JSONObject answer = new JSONObject();
            try {
                if (result.length > 0 && result[0] == PackageManager.PERMISSION_GRANTED)
                    answer.put("granted", true);
                else answer.put("error", "Доступ к микрофону запрещён Android. Разрешите его в настройках приложения ECHO.");
                reply(id, answer);
            } catch (Exception ignored) {}
        }
        if (code == MIC_REQUEST_CODE && pendingMic != null) {
            PermissionRequest req = pendingMic; pendingMic = null;
            if (result.length > 0 && result[0] == PackageManager.PERMISSION_GRANTED)
                req.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else req.deny();
        }
    }
    private void reply(String id, JSONObject data) {
        String js = "window.echoNativeReply && window.echoNativeReply(" +
            JSONObject.quote(id) + "," + data.toString() + ");";
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(js, null); });
    }
    private final class VoiceBridge {
        @JavascriptInterface public void request(String json) {
            try {
                JSONObject request = new JSONObject(json);
                String id = request.optString("id", "");
                String type = request.optString("type", "");
                if (id.isEmpty() || id.length() > 40) return;
                if ("cancel".equals(type)) return;
                if ("deviceCapabilities".equals(type)) {
                    runOnUiThread(() -> {
                        JSONObject answer = new JSONObject();
                        try {
                            ActivityManager manager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                            if (manager == null) throw new IllegalStateException("Memory service unavailable");
                            ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
                            manager.getMemoryInfo(memory);
                            answer.put("platform", "android");
                            answer.put("androidApi", Build.VERSION.SDK_INT);
                            answer.put("ramTotalMiB", memory.totalMem / (1024L * 1024L));
                            answer.put("ramAvailableMiB", memory.availMem / (1024L * 1024L));
                            answer.put("ramLow", memory.lowMemory);
                            answer.put("is64BitRuntime", android.os.Process.is64Bit());
                            answer.put("inferenceInstalled", false);
                            answer.put("model", "none");
                            // Memory alone cannot establish whether a model runs.
                            answer.put("modelCompatible", false);
                        } catch (Exception e) {
                            answer = new JSONObject();
                            try { answer.put("error", "Не удалось получить сведения о памяти Android."); }
                            catch (Exception ignored) {}
                        }
                        reply(id, answer);
                    });
                    return;
                }
                if ("microphonePermission".equals(type)) {
                    runOnUiThread(() -> {
                        try {
                            JSONObject answer = new JSONObject();
                            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                                answer.put("granted", true);
                                reply(id, answer);
                            } else if (pendingPreflightId != null) {
                                answer.put("error", "Уже ожидается разрешение на микрофон.");
                                reply(id, answer);
                            } else {
                                pendingPreflightId = id;
                                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_PREFLIGHT_CODE);
                            }
                        } catch (Exception ignored) {}
                    });
                    return;
                }
                JSONObject answer = new JSONObject();
                if ("status".equals(type)) {
                    answer.put("platform", "android");
                    answer.put("ready", false);
                    answer.put("languages", new org.json.JSONArray());
                } else {
                    answer.put("error", "Мобильный AI-движок ещё не установлен. Используйте сохранённые записи или системный голос.");
                }
                reply(id, answer);
            } catch (Exception ignored) { /* Reject malformed messages. */ }
        }
    }
    @Override protected void onDestroy() {
        if (pendingMic != null) { pendingMic.deny(); pendingMic = null; }
        if (web != null) {
            web.removeJavascriptInterface("EchoAndroid");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
