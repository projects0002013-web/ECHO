package org.echo.aac;

import android.content.Context;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** One local model, one worker, one request. Never owns or persists private audio. */
final class PocketVoiceService implements AutoCloseable {
    interface Completion { void complete(byte[] wav,String error); }
    private final Context context;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final Object lock=new Object();
    private PocketTtsEngine engine; // Worker confined, released only after inference returns.
    private volatile String phase="not_installed";
    private volatile String error="";
    private boolean preparing,closed;
    private String request;
    private AtomicBoolean cancellation;

    PocketVoiceService(Context context){this.context=context.getApplicationContext();}
    String phase(){return phase;}
    String error(){return error;}
    boolean ready(){return "ready".equals(phase) || "generating".equals(phase);}
    void retryPreparation(){synchronized(lock){if("error".equals(phase))phase="not_installed";}prepare();}
    void prepare(){
        synchronized(lock){
            if(closed || preparing || engine!=null || "error".equals(phase))return;
            preparing=true;phase="installing";error="";
            worker.execute(()->{
                try{
                    java.io.File model=PocketModelInstaller.ensureInstalled(context);
                    synchronized(lock){if(closed)return;phase="loading";}
                    PocketTtsEngine loaded=new PocketTtsEngine(model);
                    synchronized(lock){
                        if(closed){loaded.close();return;}
                        engine=loaded;phase="ready";
                    }
                }catch(Throwable failure){
                    synchronized(lock){phase="error";error=classify(failure);}
                }finally{synchronized(lock){preparing=false;}}
            });
        }
    }
    boolean generate(String id,String text,byte[] wav,Completion completion){
        synchronized(lock){
            if(closed || !"ready".equals(phase) || request!=null)return false;
            request=id;cancellation=new AtomicBoolean(false);phase="generating";
            AtomicBoolean token=cancellation;
            worker.execute(()->{
                byte[] output=null;String failure=null;
                try{
                    if(token.get())throw new IOException("cancelled");
                    PocketReferenceAudio reference=PocketReferenceAudio.decode(wav);
                    // No installation, download, or engine construction during synthesis.
                    output=engine.generate(text,reference,token,System.nanoTime()+240_000_000_000L);
                    if(token.get())throw new IOException("cancelled");
                }catch(Throwable cause){failure=token.get()?"cancelled":classify(cause);}
                synchronized(lock){request=null;cancellation=null;if(!closed)phase="ready";}
                completion.complete(output,failure);
            });
            return true;
        }
    }
    void cancel(String id){synchronized(lock){if(id.equals(request) && cancellation!=null)cancellation.set(true);}}
    static String classify(Throwable failure){
        if(failure instanceof UnsatisfiedLinkError || failure instanceof NoClassDefFoundError)return "native_runtime";
        if(failure instanceof OutOfMemoryError)return "memory";
        String message=String.valueOf(failure.getMessage());
        if(message.contains("storage") || message.contains("space"))return "storage";
        if(message.contains("checksum") || message.contains("verification"))return "checksum";
        if(message.contains("cancel"))return "cancelled";
        if(message.contains("timeout"))return "timeout";
        if(message.contains("WAV") || message.contains("PCM") || message.contains("audio") || message.contains("duration"))return "reference";
        return "engine";
    }
    @Override public void close(){
        synchronized(lock){
            if(closed)return;closed=true;phase="closed";
            if(cancellation!=null)cancellation.set(true);
            // Do not release JNI underneath an in-flight native call.
            worker.execute(()->{if(engine!=null){engine.close();engine=null;}});
            worker.shutdown();
        }
    }
}
