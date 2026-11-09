package org.echo.aac;

import android.content.Context;
import android.media.MediaPlayer;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;

/** REAL Android JNI + ONNX inference, synthetic references only. No likeness claim. */
@RunWith(AndroidJUnit4.class)
public final class PocketAndroidInferenceTest {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private static void u16(byte[] b,int at,int n){b[at]=(byte)n;b[at+1]=(byte)(n>>>8);}
    private static void u32(byte[] b,int at,int n){u16(b,at,n);u16(b,at+2,n>>>16);}
    static byte[] reference(int rate){
        int samples=rate*6;byte[] wav=new byte[44+samples*2];
        System.arraycopy("RIFF".getBytes(StandardCharsets.US_ASCII),0,wav,0,4);u32(wav,4,wav.length-8);
        System.arraycopy("WAVEfmt ".getBytes(StandardCharsets.US_ASCII),0,wav,8,8);
        u32(wav,16,16);u16(wav,20,1);u16(wav,22,1);u32(wav,24,rate);u32(wav,28,rate*2);u16(wav,32,2);u16(wav,34,16);
        System.arraycopy("data".getBytes(StandardCharsets.US_ASCII),0,wav,36,4);u32(wav,40,samples*2);
        for(int i=0;i<samples;i++)u16(wav,44+i*2,(int)(3000*Math.sin(2*Math.PI*180*i/rate)));
        return wav;
    }
    private void playable(byte[] wav)throws Exception{
        assertTrue("new nonempty WAV",wav.length>44);
        assertEquals("RIFF",new String(wav,0,4,StandardCharsets.US_ASCII));
        assertEquals("WAVE",new String(wav,8,4,StandardCharsets.US_ASCII));
        // A RIFF header alone does not prove that the neural engine created audio.
        // Assert that the actual PCM contains an audible, non-silent signal.
        int peak=0, nonzero=0;
        for(int i=44;i+1<wav.length;i+=2){
            int pcm=(short)((wav[i]&0xff)|((wav[i+1]&0xff)<<8));
            peak=Math.max(peak,Math.abs(pcm));
            if(Math.abs(pcm)>64)nonzero++;
        }
        assertTrue("generated AI-WAV contains no audible PCM signal",peak>128 && nonzero>1024);

        File result=new File(context.getCacheDir(),"inference-test.wav");
        try{
            try(FileOutputStream out=new FileOutputStream(result)){out.write(wav);}
            MediaPlayer player=new MediaPlayer();
            try{player.setDataSource(result.getAbsolutePath());player.prepare();assertTrue(player.getDuration()>0);player.start();Thread.sleep(150);player.stop();}
            finally{player.release();}
        }finally{result.delete();}
    }
    @Test public void realNativeInferenceResamplingCancellationAndPlayback()throws Exception{
        File model=PocketModelInstaller.ensureInstalled(context);
        try(PocketTtsEngine engine=new PocketTtsEngine(model)){
            AtomicBoolean cancelled=new AtomicBoolean(true);
            try{engine.generate("Do not start.",PocketReferenceAudio.decode(reference(16000)),cancelled,System.nanoTime()+30_000_000_000L);fail("pre-start cancellation lost");}
            catch(IOException expected){assertTrue(expected.getMessage().contains("cancel"));}
            playable(engine.generate("Hello. This is a new ECHO sentence.",PocketReferenceAudio.decode(reference(48000))));
            ExecutorService thread=Executors.newSingleThreadExecutor();
            try{
                AtomicBoolean stop=new AtomicBoolean();CountDownLatch entered=new CountDownLatch(1);
                Future<byte[]> pending=thread.submit(()->{entered.countDown();return engine.generate("This longer message must stop before it finishes. This is a cancellation test for ECHO.",PocketReferenceAudio.decode(reference(16000)),stop,System.nanoTime()+60_000_000_000L);});
                assertTrue(entered.await(5,TimeUnit.SECONDS));Thread.sleep(150);stop.set(true);
                try{pending.get(90,TimeUnit.SECONDS);fail("cancelled output returned");}
                catch(ExecutionException expected){assertTrue(expected.getCause() instanceof IOException);}
            }finally{thread.shutdownNow();}
            try{engine.generate("Stop when time runs out.",PocketReferenceAudio.decode(reference(16000)),new AtomicBoolean(),System.nanoTime()+100_000_000L);fail("running deadline ignored");}
            catch(IOException expected){assertTrue(expected.getMessage().contains("timeout"));}
            playable(engine.generate("Ready again.",PocketReferenceAudio.decode(reference(44100))));
        }
    }
    @Test public void corruptedModelIsRejectedAndRecoveredWithoutTouchingUserData()throws Exception{
        File model=PocketModelInstaller.ensureInstalled(context);
        JSONObject hashes;
        try(InputStream in=context.getAssets().open("pockettts/hashes.json")){
            ByteArrayOutputStream data=new ByteArrayOutputStream();byte[] buf=new byte[1024];int n;
            while((n=in.read(buf))!=-1)data.write(buf,0,n);
            hashes=new JSONObject(data.toString("UTF-8"));
        }
        File sentinel=new File(context.getFilesDir(),"acceptance-user-data.txt");
        try{
            try(FileOutputStream out=new FileOutputStream(sentinel)){out.write(42);}
            try(RandomAccessFile weights=new RandomAccessFile(new File(model,"vocab.json"),"rw")){weights.write(0);}
            assertFalse("corrupted model accepted",PocketModelInstaller.valid(model,hashes));
            assertTrue(PocketModelInstaller.valid(PocketModelInstaller.ensureInstalled(context),hashes));
            try(FileInputStream in=new FileInputStream(sentinel)){assertEquals(42,in.read());}
        }finally{sentinel.delete();}
    }
    @Test public void serviceSerializesRequestsAndSurvivesStop()throws Exception{
        try(PocketVoiceService service=new PocketVoiceService(context)){
            service.prepare();long deadline=System.nanoTime()+180_000_000_000L;
            while(!service.ready() && !"error".equals(service.phase()) && System.nanoTime()<deadline)Thread.sleep(100);
            assertTrue(service.error(),service.ready());
            CountDownLatch done=new CountDownLatch(1);String[] error={null};
            assertTrue(service.generate("first","Hello.",reference(16000),(wav,err)->{error[0]=err;done.countDown();}));
            assertFalse("parallel synthesis accepted",service.generate("second","Hello.",reference(16000),(w,e)->{}));
            service.cancel("first");assertTrue(done.await(90,TimeUnit.SECONDS));assertEquals("cancelled",error[0]);
            CountDownLatch next=new CountDownLatch(1);byte[][] output={null};
            assertTrue(service.generate("again","Hello again.",reference(16000),(wav,err)->{output[0]=wav;error[0]=err;next.countDown();}));
            assertTrue(next.await(180,TimeUnit.SECONDS));assertNull(error[0]);playable(output[0]);
        }
    }
}
