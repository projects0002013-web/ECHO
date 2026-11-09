package org.echo.aac;

import android.app.Instrumentation;
import android.content.Intent;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

/** Actual packaged WebView -> IndexedDB -> Java bridge -> Android JNI -> cached WAV.
 * Uses a generated test signal, never a person's unconsented voice. Microphone/likeness
 * and acoustic playback on a physical device remain separate acceptance checks.
 */
@RunWith(AndroidJUnit4.class)
public final class PocketWebViewFlowTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private String evaluate(WebView web,String js)throws Exception{
        CountDownLatch done=new CountDownLatch(1);String[] value={null};
        instrumentation.runOnMainSync(()->web.evaluateJavascript(js,result->{value[0]=result;done.countDown();}));
        assertTrue("WebView did not respond",done.await(15,TimeUnit.SECONDS));return value[0];
    }
    private void until(WebView web,String condition,int seconds)throws Exception{
        long end=System.nanoTime()+seconds*1_000_000_000L;
        while(System.nanoTime()<end){if("true".equals(evaluate(web,condition)))return;Thread.sleep(200);}
        fail("WebView flow timed out: "+condition+"; "+evaluate(web,"document.getElementById('echoStudioStatus')?.textContent+' / '+document.getElementById('echoPCRequirement')?.textContent"));
    }
    @Test public void nativeBridgeRejectsMissingConsentAndUnsupportedLanguage()throws Exception{
        Intent launch=new Intent(instrumentation.getTargetContext(),MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        MainActivity activity=(MainActivity)instrumentation.startActivitySync(launch);
        WebView[] web={null};
        instrumentation.runOnMainSync(()->web[0]=(WebView)((ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0));
        try{
            until(web[0],"!!window.echoNativeReply && !!window.EchoAndroid",60);
            // Invoke the native security boundary directly, not a mocked JavaScript
            // wrapper. Neither rejection may trigger generation or save voice data.
            evaluate(web[0],"window.nativeSecurityReplies={};(()=>{const old=window.echoNativeReply;window.echoNativeReply=(id,data)=>{nativeSecurityReplies[id]=data;old?.(id,data)};})()");
            evaluate(web[0],"EchoAndroid.request(JSON.stringify({id:'missing-owner-consent',type:'synthesize',text:'Hello',language:'en',referenceWavBase64:'UklGRg==',consent:false}))");
            until(web[0],"!!nativeSecurityReplies['missing-owner-consent']",10);
            assertEquals("false",evaluate(web[0],"String(nativeSecurityReplies['missing-owner-consent'].wavBase64!==undefined)"));
            assertEquals("true",evaluate(web[0],"String(typeof nativeSecurityReplies['missing-owner-consent'].error==='string')"));
            evaluate(web[0],"EchoAndroid.request(JSON.stringify({id:'wrong-language',type:'synthesize',text:'Hello',language:'ru',referenceWavBase64:'UklGRg==',consent:true}))");
            until(web[0],"!!nativeSecurityReplies['wrong-language']",10);
            assertEquals("false",evaluate(web[0],"String(nativeSecurityReplies['wrong-language'].wavBase64!==undefined)"));
            assertEquals("true",evaluate(web[0],"String(typeof nativeSecurityReplies['wrong-language'].error==='string')"));
        }finally{instrumentation.runOnMainSync(activity::finish);}
    }
    @Test public void savedSampleConsentNewTextAndRealNativeWav()throws Exception{
        Intent launch=new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        MainActivity activity=(MainActivity)instrumentation.startActivitySync(launch);
        WebView[] web={null};
        instrumentation.runOnMainSync(()->web[0]=(WebView)((ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0));
        try{
            until(web[0],"!!document.getElementById('echoDataPanel') && !!window.echoNativeVoice && !document.querySelector('.app').inert",60);
            assertEquals("1",evaluate(web[0],"echoNativeVoice.apiVersion"));
            evaluate(web[0],"document.querySelector('[data-language=en]').click();document.getElementById('echoVoiceStudioNav').click()");
            String sample=Base64.encodeToString(PocketAndroidInferenceTest.reference(48000),Base64.NO_WRAP);
            evaluate(web[0],"(()=>{const bytes=Uint8Array.from(atob("+JSONObject.quote(sample)+"),c=>c.charCodeAt(0));const files=new DataTransfer();files.items.add(new File([bytes],'synthetic-test.wav',{type:'audio/wav'}));const input=document.getElementById('echoAudioImport');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
            until(web[0],"!document.getElementById('echoAudioDraft').hidden",30);
            evaluate(web[0],"document.getElementById('echoVoiceConsent').click();document.getElementById('echoDraftSave').click()");
            until(web[0],"document.getElementById('echoAudioDraft').hidden",30);
            evaluate(web[0],"document.getElementById('echoStudioText').value='Please bring some water.';document.getElementById('echoStudioText').dispatchEvent(new Event('input',{bubbles:true}))");
            assertEquals("true",evaluate(web[0],"document.getElementById('echoStudioGenerate').disabled"));
            evaluate(web[0],"document.getElementById('echoStudioConsent').click()");
            until(web[0],"!document.getElementById('echoStudioGenerate').disabled",240);
            evaluate(web[0],"document.getElementById('echoStudioGenerate').click()");
            until(web[0],"!document.getElementById('echoStudioResult').hidden",270);
            // Examine the actual IndexedDB audio produced by JNI, not a host mock or preset.
            evaluate(web[0],"window.checkedNativeWav=false;(()=>{const open=indexedDB.open('echo-local-voice',1);open.onsuccess=()=>{const db=open.result,tx=db.transaction('cache'),r=tx.objectStore('cache').getAll();r.onsuccess=async()=>{const a=r.result.find(a=>a.key.endsWith(':en:Please bring some water.'));if(a){const bytes=new Uint8Array(await a.blob.slice(0,12).arrayBuffer());window.checkedNativeWav=a.blob.size>44 && String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WAVE';}db.close();};};})()");
            until(web[0],"window.checkedNativeWav===true",15);
        }finally{instrumentation.runOnMainSync(activity::finish);}
    }
}
