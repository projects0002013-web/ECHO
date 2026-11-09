import org.echo.aac.PocketTtsEngine;
import org.echo.aac.PocketReferenceAudio;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.util.Locale;

/** Real ONNX inference smoke (not a mock). Synthetic reference only checks function. */
public final class PocketTtsInferenceSmoke {
  static void u16(byte[] b,int i,int n){b[i]=(byte)n;b[i+1]=(byte)(n>>>8);}
  static void u32(byte[] b,int i,int n){u16(b,i,n);u16(b,i+2,n>>>16);}
  static byte[] reference(){return reference(16000);}
  static byte[] reference(int rate){
    int samples=rate*6;
    byte[] wav=new byte[44+2*samples];
    byte[] tags="RIFF".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
    System.arraycopy(tags,0,wav,0,4);u32(wav,4,wav.length-8);
    System.arraycopy("WAVEfmt ".getBytes(java.nio.charset.StandardCharsets.US_ASCII),0,wav,8,8);
    u32(wav,16,16);u16(wav,20,1);u16(wav,22,1);
    u32(wav,24,rate);u32(wav,28,2*rate);u16(wav,32,2);u16(wav,34,16);
    System.arraycopy("data".getBytes(java.nio.charset.StandardCharsets.US_ASCII),0,wav,36,4);
    u32(wav,40,samples*2);
    for(int i=0;i<samples;i++){
      double t=i/(double)rate;
      int sample=(int)(2000*Math.sin(2*Math.PI*180*t) + 1800*Math.sin(2*Math.PI*300*t));
      u16(wav,44+2*i,sample);
    }
    return wav;
  }
  public static void main(String[] args)throws Exception{
    if(args.length!=1)throw new IllegalArgumentException("model directory required");
    File dir=new File(args[0]);
    if(!PocketTtsEngine.hasModel(dir))throw new IllegalStateException("missing actual model files");
    PocketReferenceAudio sample=PocketReferenceAudio.decode(
      new ByteArrayInputStream(reference()));
    long start=System.nanoTime();
    try(PocketTtsEngine tts=new PocketTtsEngine(dir)){
      java.util.concurrent.atomic.AtomicBoolean preCancelled=new java.util.concurrent.atomic.AtomicBoolean(true);
      try{tts.generate("Must not start.",sample,preCancelled,System.nanoTime()+30_000_000_000L);throw new AssertionError("pre-start cancellation lost");}
      catch(java.io.IOException expected){if(!expected.getMessage().contains("cancel"))throw expected;}
      try{tts.generate("Already expired.",sample,new java.util.concurrent.atomic.AtomicBoolean(),System.nanoTime()-1);throw new AssertionError("deadline ignored");}
      catch(java.io.IOException expected){if(!expected.getMessage().contains("timeout"))throw expected;}
      byte[] generated=tts.generate("Hello. This is ECHO.",sample);
      if(generated.length<=44 || generated.length>8*1024*1024)
        throw new AssertionError("AI did not generate a real WAV");
      if(!new String(generated,0,4,java.nio.charset.StandardCharsets.US_ASCII).equals("RIFF")||
         !new String(generated,8,4,java.nio.charset.StandardCharsets.US_ASCII).equals("WAVE"))
        throw new AssertionError("Generated WAV is invalid");
      java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();
      try{
        var token=new java.util.concurrent.atomic.AtomicBoolean();
        var pending=worker.submit(()->tts.generate("A longer cancellation test for ECHO. Please stop creating this message.",sample,token,System.nanoTime()+60_000_000_000L));
        Thread.sleep(150);token.set(true);
        try{pending.get(90,java.util.concurrent.TimeUnit.SECONDS);throw new AssertionError("cancelled inference returned WAV");}
        catch(java.util.concurrent.ExecutionException expected){if(!(expected.getCause() instanceof java.io.IOException))throw expected;}
      }finally{worker.shutdownNow();}
      try{tts.generate("Stop when the deadline expires.",sample,new java.util.concurrent.atomic.AtomicBoolean(),System.nanoTime()+100_000_000L);throw new AssertionError("running deadline ignored");}
      catch(java.io.IOException expected){if(!expected.getMessage().contains("timeout"))throw expected;}
      byte[] repeated=tts.generate("Hello again.",PocketReferenceAudio.decode(reference(48000)));
      if(repeated.length<=44)throw new AssertionError("repeat inference failed");
      double seconds=(System.nanoTime()-start)/1.0e9;
      System.out.printf(Locale.ROOT,"REAL ONNX INFERENCE + pre-start/during cancellation + repeat/48kHz: %d WAV bytes, %.2f s; synthetic sample, not a voice-similarity test%n",generated.length,seconds);
    }
  }
}
