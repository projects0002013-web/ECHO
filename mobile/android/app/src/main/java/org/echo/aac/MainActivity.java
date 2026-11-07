package org.echo.aac;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import java.util.Set;
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
    private TextToSpeech offlineTts;
    private volatile boolean offlineTtsReady = false;
    private PermissionRequest pendingMic;
    private WebViewAssetLoader assets;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        offlineTts = new TextToSpeech(getApplicationContext(),
            status -> offlineTtsReady = status == TextToSpeech.SUCCESS);
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
                if ("deviceTtsStatus".equals(type) || "deviceSpeak".equals(type) || "deviceStop".equals(type)) {
                    runOnUiThread(() -> {
                        JSONObject answer = new JSONObject();
                        try {
                            if ("deviceStop".equals(type)) {
                                if (offlineTts != null) offlineTts.stop();
                                answer.put("stopped", true);
                            } else if ("deviceTtsStatus".equals(type)) {
                                answer.put("ready", offlineTtsReady && offlineTts != null);
                                answer.put("kind", "system-offline-tts");
                                answer.put("personalVoice", false);
                            } else {
                                String phrase = request.optString("text", "").trim();
                                String lang = request.optString("language", "ru");
                                if (phrase.isEmpty() || phrase.length() > 300 || !lang.matches("ru|en|kk|be")) {
                                    answer.put("error", "Некорректная фраза или язык.");
                                } else if (!offlineTtsReady || offlineTts == null) {
                                    answer.put("error", "Озвучка Android ещё не готова.");
                                } else {
                                    Voice local = null;
                                    Set<Voice> voices = offlineTts.getVoices();
                                    if (voices != null) for (Voice candidate : voices) {
                                        if (!candidate.isNetworkConnectionRequired() && candidate.getLocale() != null
                                              && lang.equalsIgnoreCase(candidate.getLocale().getLanguage())) {
                                            local = candidate;
                                            break;
                                        }
                                    }
                                    if (local == null) answer.put("error", "Нет установленного офлайн-голоса этого языка.");
                                    else {
                                        offlineTts.stop();
                                        if (offlineTts.setVoice(local) != TextToSpeech.SUCCESS)
                                            answer.put("error", "Невозможно выбрать офлайн-голос.");
                                        else if (offlineTts.speak(phrase, TextToSpeech.QUEUE_FLUSH, null,
                                                                 "echo-" + id) != TextToSpeech.SUCCESS)
                                            answer.put("error", "Android не запустил озвучку.");
                                        else { answer.put("queued", true); answer.put("personalVoice", false); }
                                    }
                                }
                            }
                        } catch (Exception ignored) {
                            try { answer.put("error", "Системная озвучка Android недоступна."); }
                            catch (Exception ignoredAgain) {}
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
        if (offlineTts != null) { offlineTts.stop(); offlineTts.shutdown(); offlineTts = null; }
        if (web != null) {
            web.removeJavascriptInterface("EchoAndroid");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
