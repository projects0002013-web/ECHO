package org.echo.aac;

import android.Manifest;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.speech.tts.UtteranceProgressListener;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.ValueCallback;
import java.io.OutputStream;
import android.util.Base64;
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
import androidx.webkit.WebViewFeature;
import androidx.webkit.ServiceWorkerClientCompat;
import androidx.webkit.ServiceWorkerControllerCompat;
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
    private static final int FILE_PICKER_CODE=403, SAVE_FILE_CODE=404;
    private ValueCallback<Uri[]> pendingFiles;
    private String pendingSaveId, saveSession;
    private OutputStream saveStream;
    private long savedBytes;
    private final Object saveLock=new Object();
    private TextToSpeech deviceTts;
    private volatile boolean ttsReady;
    private PocketVoiceService pocketVoice;
    private final java.util.concurrent.ExecutorService referenceWorker =
        java.util.concurrent.Executors.newSingleThreadExecutor();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        pocketVoice=new PocketVoiceService(this);
        assets = new WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();
        if(WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE))ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(new ServiceWorkerClientCompat(){
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest req){
                if(!LOCAL_ORIGIN.equals(req.getUrl().getScheme()+"://"+req.getUrl().getHost()))return blocked();
                WebResourceResponse local=assets.shouldInterceptRequest(req.getUrl());return local!=null?local:blocked();
            }
        });
        web = new WebView(this);
        setContentView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        // Explicitly forbid legacy file:// JavaScript bridges and cross-file access.
        // Android's scoped document picker remains available through content:// grants.
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setAllowContentAccess(true); // Only explicit document-picker grants are readable.
        settings.setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
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
                if(req.isForMainFrame() && "tel:112".equals(req.getUrl().toString())){try{startActivity(new Intent(Intent.ACTION_DIAL,req.getUrl()));}catch(Exception ignored){}return true;}
                return !LOCAL_ORIGIN.equals(req.getUrl().getScheme() + "://" + req.getUrl().getHost());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if(pendingFiles!=null)pendingFiles.onReceiveValue(null);
                pendingFiles=callback;
                try {startActivityForResult(params.createIntent(),FILE_PICKER_CODE);}
                catch(Exception error){pendingFiles.onReceiveValue(null);pendingFiles=null;}
                return true;
            }
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
        web.setOnApplyWindowInsetsListener((view,insets)->{
            int left,top,right,bottom;
            if(Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars());left=bars.left;top=bars.top;right=bars.right;bottom=bars.bottom;}
            else {left=insets.getSystemWindowInsetLeft();top=insets.getSystemWindowInsetTop();right=insets.getSystemWindowInsetRight();bottom=insets.getSystemWindowInsetBottom();}
            view.setPadding(left,top,right,bottom);return insets;
        });
        // The packaged UI is in assets/www; AssetLoader maps URL paths to assets paths.
        deviceTts=new TextToSpeech(this,status->{ttsReady=status==TextToSpeech.SUCCESS;if(web!=null)web.evaluateJavascript("window.echoAndroidSpeech && window.echoAndroidSpeech.refresh()",null);});
        deviceTts.setOnUtteranceProgressListener(new UtteranceProgressListener(){
            @Override public void onStart(String id){ttsEvent(id,"start");}
            @Override public void onDone(String id){ttsEvent(id,"end");}
            @Override public void onError(String id){ttsEvent(id,"error");}
        });
        web.loadUrl(LOCAL_ORIGIN + "/www/index.html");
    }
    @Override protected void onActivityResult(int code,int result,Intent data){
        super.onActivityResult(code,result,data);
        if(code==FILE_PICKER_CODE && pendingFiles!=null){pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));pendingFiles=null;}
        if(code==SAVE_FILE_CODE && pendingSaveId!=null){
            String id=pendingSaveId;pendingSaveId=null;JSONObject answer=new JSONObject();
            try {
                if(result!=RESULT_OK || data==null || data.getData()==null)throw new Exception("cancelled");
                synchronized(saveLock){saveStream=getContentResolver().openOutputStream(data.getData(),"w");if(saveStream==null)throw new Exception("open");saveSession=id;savedBytes=0;}
                answer.put("session",id);
            }catch(Exception error){try{answer.put("error","Не удалось сохранить файл: выбор отменён или хранилище недоступно.");}catch(Exception ignored){}}
            reply(id,answer);
        }
    }
    private void closeSave(){synchronized(saveLock){try{if(saveStream!=null)saveStream.close();}catch(Exception ignored){}saveStream=null;saveSession=null;savedBytes=0;}}
    private void ttsEvent(String id,String state){runOnUiThread(()->{if(web!=null)web.evaluateJavascript("window.echoNativeTTSEvent && window.echoNativeTTSEvent("+JSONObject.quote(id)+","+JSONObject.quote(state)+")",null);});}
    private void handleTts(String id,String type,JSONObject request){
        JSONObject answer=new JSONObject();
        try {
            if("ttsVoices".equals(type)){
                org.json.JSONArray voices=new org.json.JSONArray();
                if(ttsReady && deviceTts.getVoices()!=null)for(Voice voice:deviceTts.getVoices())if(!voice.isNetworkConnectionRequired()){
                    JSONObject item=new JSONObject();item.put("name",voice.getName());item.put("lang",voice.getLocale().toLanguageTag());voices.put(item);
                }
                answer.put("voices",voices);answer.put("loading",!ttsReady);
            }else if("ttsStop".equals(type)){if(deviceTts!=null)deviceTts.stop();answer.put("stopped",true);}
            else {
                String text=request.optString("text"),language=request.optString("language"),name=request.optString("voice"),utterance=request.optString("utteranceId");
                if(!ttsReady || text.isEmpty() || text.length()>300 || !utterance.matches("[A-Za-z0-9_-]{1,40}"))throw new Exception("unavailable");
                String code=language.split("-")[0];Voice chosen=null,fallback=null;
                if(deviceTts.getVoices()!=null)for(Voice voice:deviceTts.getVoices())if(!voice.isNetworkConnectionRequired() && voice.getLocale().getLanguage().equals(code)){
                    if(fallback==null)fallback=voice;if(voice.getName().equals(name))chosen=voice;
                }
                if(chosen==null)chosen=fallback;if(chosen==null)throw new Exception("missing voice");
                if(deviceTts.setVoice(chosen)==TextToSpeech.ERROR)throw new Exception("voice");deviceTts.setSpeechRate((float)Math.max(.5,Math.min(2,request.optDouble("rate",1))));deviceTts.setPitch((float)Math.max(.5,Math.min(2,request.optDouble("pitch",1))));
                Bundle parameters=new Bundle();parameters.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME,(float)Math.max(0,Math.min(1,request.optDouble("volume",1))));parameters.putString(TextToSpeech.Engine.KEY_FEATURE_EMBEDDED_SYNTHESIS,"true");
                if(deviceTts.speak(text,TextToSpeech.QUEUE_FLUSH,parameters,utterance)==TextToSpeech.ERROR)throw new Exception("speak");answer.put("accepted",true);
            }
        }catch(Exception error){try{answer.put("error","Голос устройства недоступен. Проверьте установленные голоса.");}catch(Exception ignored){}}
        reply(id,answer);
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
                if ("cancel".equals(type)) {
                    pocketVoice.cancel(id);
                    return;
                }
                if ("synthesize".equals(type)) {
                    // All inference remains on-device; never upload a private reference.
                    final String input=request.optString("text","");
                    final String language=request.optString("language","");
                    final String encoded=request.optString("referenceWavBase64","");
                    final boolean consent=request.optBoolean("consent",false);
                    JSONObject answer=new JSONObject();
                    if(!consent || !"en".equals(language) || input.trim().isEmpty() ||
                       input.length()>300 || encoded.length()>((PocketReferenceAudio.MAX_BYTES+2L)/3L)*4L+8L) {
                        answer.put("error","Требуются согласие владельца, английский текст и WAV до 8 МБ.");
                        reply(id,answer);return;
                    }
                    if(!PocketModelInstaller.bundled(MainActivity.this)) {
                        answer.put("error","Локальные файлы PocketTTS ещё не установлены.");
                        reply(id,answer);return;
                    }
                    byte[] reference;
                    try{reference=Base64.decode(encoded,Base64.NO_WRAP);}
                    catch(IllegalArgumentException invalid){answer.put("error","reference");reply(id,answer);return;}
                    boolean accepted=pocketVoice.generate(id,input,reference,(wav,error)->{
                        JSONObject result=new JSONObject();
                        try{
                            if(error!=null)result.put("error",error);
                            else result.put("wavBase64",Base64.encodeToString(wav,Base64.NO_WRAP));
                        }catch(Exception ignored){}
                        reply(id,result);
                    });
                    if(!accepted){answer.put("error", "generating".equals(pocketVoice.phase())?"busy":"model_not_ready");reply(id,answer);}
                    return;
                }
                if("ttsVoices".equals(type) || "ttsSpeak".equals(type) || "ttsStop".equals(type)){runOnUiThread(()->handleTts(id,type,request));return;}
                if ("aiReferenceCheck".equals(type)) {
                    // Explicit user-selected WAV; decode on a worker, never on the UI thread.
                    // No reference bytes are stored, uploaded or passed to third-party services.
                    String encoded=request.optString("referenceWavBase64","");
                    if(encoded.length() > ((PocketReferenceAudio.MAX_BYTES + 2L) / 3L) * 4L + 8L) {
                        JSONObject answer=new JSONObject();
                        answer.put("error","Образец WAV превышает 8 МБ.");
                        reply(id,answer);
                        return;
                    }
                    referenceWorker.execute(() -> {
                        JSONObject answer=new JSONObject();
                        try {
                            byte[] bytes=Base64.decode(encoded,Base64.NO_WRAP);
                            PocketReferenceAudio pcm=PocketReferenceAudio.decode(bytes);
                            answer.put("valid",true);
                            answer.put("sampleRate",pcm.sampleRate);
                            answer.put("durationSeconds",pcm.durationSeconds);
                            answer.put("modelReady",pocketVoice.ready());
                        }catch(Exception error) {
                            try{answer.put("error","Нужна слышимая запись: моно PCM WAV, 16 бит, 5–30 секунд.");}
                            catch(Exception ignored){}
                        }
                        reply(id,answer);
                    });
                    return;
                }
                if ("saveStart".equals(type)) {
                    String name=request.optString("name","ECHO-backup.json").replaceAll("[^A-Za-z0-9._-]","_");
                    runOnUiThread(()->{JSONObject a=new JSONObject();try{
                        synchronized(saveLock){if(pendingSaveId!=null || saveStream!=null)throw new Exception("busy");pendingSaveId=id;}
                        Intent pick=new Intent(Intent.ACTION_CREATE_DOCUMENT);pick.addCategory(Intent.CATEGORY_OPENABLE);pick.setType("application/json");pick.putExtra(Intent.EXTRA_TITLE,name);startActivityForResult(pick,SAVE_FILE_CODE);
                    }catch(Exception error){if(id.equals(pendingSaveId))pendingSaveId=null;try{a.put("error","Не удалось открыть сохранение файла. Завершите предыдущую операцию.");}catch(Exception ignored){}reply(id,a);}});
                    return;
                }
                if ("saveChunk".equals(type) || "saveFinish".equals(type) || "saveAbort".equals(type)) {
                    JSONObject a=new JSONObject();
                    try {synchronized(saveLock){
                        if(saveStream==null || !request.optString("session").equals(saveSession))throw new Exception("session");
                        if("saveChunk".equals(type)){
                            String encoded=request.optString("base64");if(encoded.length()>90000)throw new Exception("chunk");
                            byte[] bytes=Base64.decode(encoded,Base64.NO_WRAP);if(bytes.length>65536 || savedBytes+bytes.length>100L*1024*1024)throw new Exception("size");
                            saveStream.write(bytes);savedBytes+=bytes.length;a.put("written",true);
                        } else if("saveAbort".equals(type)){closeSave();a.put("saved",false);} else {saveStream.flush();saveStream.close();saveStream=null;saveSession=null;savedBytes=0;a.put("saved",true);}
                    }}catch(Exception error){closeSave();a.put("error","Не удалось записать файл. Проверьте свободное место.");}
                    reply(id,a);return;
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
                if ("status".equals(type) || "prepare".equals(type)) {
                    answer.put("platform", "android");
                    boolean bundled=PocketModelInstaller.bundled(MainActivity.this);
                    if("prepare".equals(type))pocketVoice.retryPreparation();else pocketVoice.prepare();
                    answer.put("ready",pocketVoice.ready());
                    answer.put("phase",pocketVoice.phase());
                    answer.put("errorCode",pocketVoice.error());
                    answer.put("languages",pocketVoice.ready() ? new org.json.JSONArray().put("en") : new org.json.JSONArray());
                    answer.put("modelFilesPresent",bundled);
                    answer.put("engine","sherpa-onnx-pocket");
                    answer.put("localOnly",true);
                    answer.put("supportsReference",true);
                    answer.put("modelReady",pocketVoice.ready());
                    answer.put("licenseVerified",pocketVoice.ready());
                } else {
                    answer.put("error", "Мобильный AI-движок ещё не установлен. Используйте сохранённые записи или системный голос.");
                }
                reply(id, answer);
            } catch (Exception ignored) { /* Reject malformed messages. */ }
        }
    }
    @Override public void onBackPressed(){
        if(web==null){finish();return;}
        web.evaluateJavascript("(()=>{const cat=document.querySelector('.echo-category-modal');if(cat && !cat.hidden){echoCloseCategoryModal();return true;}const modal=document.getElementById('addPhraseModal');if(modal && modal.classList.contains('open')){closeAddModal();return true;}if(document.body.dataset.echoSection && document.body.dataset.echoSection!=='phrases'){document.getElementById('phrasesTab').click();return true;}return false;})()",result->{if(!"true".equals(result))finish();});
    }
    @Override protected void onDestroy() {
        if(pocketVoice!=null)pocketVoice.close();
        referenceWorker.shutdownNow();
        if(deviceTts!=null){deviceTts.stop();deviceTts.shutdown();deviceTts=null;}
        closeSave();
        if(pendingFiles!=null){pendingFiles.onReceiveValue(null);pendingFiles=null;}
        if (pendingMic != null) { pendingMic.deny(); pendingMic = null; }
        if (web != null) {
            web.removeJavascriptInterface("EchoAndroid");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
