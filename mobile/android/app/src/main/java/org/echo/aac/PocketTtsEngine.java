package org.echo.aac;

import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.GenerationConfig;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsPocketModelConfig;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;

/** Real sherpa-onnx PocketTTS inference. Requires verified, locally installed model files.
 * All methods that load/generate must execute off the Android UI thread.
 * Never log user text, voice samples or generated audio.
 */
public final class PocketTtsEngine implements AutoCloseable {
  private static final String[] REQUIRED = {
      "lm_flow.int8.onnx", "lm_main.int8.onnx", "encoder.onnx",
      "decoder.int8.onnx", "text_conditioner.onnx", "vocab.json", "token_scores.json"
  };
  private final OfflineTts engine;
  private volatile AtomicBoolean activeCancellation;

  public static boolean hasModel(File directory) {
    if(directory == null || !directory.isDirectory())return false;
    for(String file:REQUIRED){
      File target=new File(directory,file);
      if(!target.isFile() || target.length()==0 || !target.getParentFile().equals(directory))
        return false;
    }
    return true;
  }
  public PocketTtsEngine(File directory) throws IOException {
    if(!hasModel(directory))throw new IOException("PocketTTS model files are missing.");
    OfflineTtsPocketModelConfig pocket=OfflineTtsPocketModelConfig.builder()
        .setLmFlow(new File(directory,REQUIRED[0]).getAbsolutePath())
        .setLmMain(new File(directory,REQUIRED[1]).getAbsolutePath())
        .setEncoder(new File(directory,REQUIRED[2]).getAbsolutePath())
        .setDecoder(new File(directory,REQUIRED[3]).getAbsolutePath())
        .setTextConditioner(new File(directory,REQUIRED[4]).getAbsolutePath())
        .setVocabJson(new File(directory,REQUIRED[5]).getAbsolutePath())
        .setTokenScoresJson(new File(directory,REQUIRED[6]).getAbsolutePath())
        .build();
    OfflineTtsModelConfig model=OfflineTtsModelConfig.builder()
        .setPocket(pocket).setNumThreads(2).setDebug(false).build();
    engine=new OfflineTts(OfflineTtsConfig.builder().setModel(model).build());
  }
  public void cancel(){AtomicBoolean token=activeCancellation;if(token!=null)token.set(true);}
  public synchronized byte[] generate(String text, PocketReferenceAudio reference) throws IOException {
    return generate(text,reference,new AtomicBoolean(false),System.nanoTime()+240_000_000_000L);
  }
  /** A request owns its token; Stop before JNI starts must never be reset. */
  public synchronized byte[] generate(String text,PocketReferenceAudio reference,AtomicBoolean cancelled,
                         long deadlineNanos) throws IOException {
    if(text==null||text.trim().isEmpty()||text.length()>300||reference==null||cancelled==null)
      throw new IOException("Invalid text or voice reference.");
    if(cancelled.get() || Thread.currentThread().isInterrupted())throw new IOException("cancelled");
    if(System.nanoTime()>deadlineNanos)throw new IOException("timeout");
    activeCancellation=cancelled;
    try {
      GenerationConfig generation=new GenerationConfig();
      generation.setReferenceAudio(reference.samples);
      generation.setReferenceSampleRate(reference.sampleRate);
      generation.setNumSteps(5);
      GeneratedAudio output=engine.generateWithConfigAndCallback(
          text.trim(),generation,samples->{
            return cancelled.get() || Thread.currentThread().isInterrupted() || System.nanoTime()>deadlineNanos?0:1;
          });
      if(cancelled.get())throw new IOException("Voice generation cancelled.");
      if(System.nanoTime()>deadlineNanos)throw new IOException("timeout");
      if(output==null || output.getSamples()==null || output.getSampleRate()<8000)
        throw new IOException("PocketTTS did not return audio.");
      return toWav(output.getSamples(),output.getSampleRate());
    } finally { activeCancellation=null; }
  }
  private static void le16(ByteArrayOutputStream out,int value){
    out.write(value&255);out.write((value>>>8)&255);
  }
  private static void le32(ByteArrayOutputStream out,int value){
    le16(out,value);le16(out,value>>>16);
  }
  private static byte[] toWav(float[] samples,int rate) throws IOException {
    if(samples.length==0||samples.length>rate*60L)
      throw new IOException("Invalid synthesized audio duration.");
    ByteArrayOutputStream out=new ByteArrayOutputStream(44+samples.length*2);
    out.write(new byte[]{'R','I','F','F'});
    le32(out,36+samples.length*2);
    out.write(new byte[]{'W','A','V','E','f','m','t',' '});
    le32(out,16);le16(out,1);le16(out,1);le32(out,rate);le32(out,rate*2);
    le16(out,2);le16(out,16);
    out.write(new byte[]{'d','a','t','a'});
    le32(out,samples.length*2);
    for(float sample:samples){
      if(!Float.isFinite(sample))throw new IOException("Invalid generated sample.");
      int pcm=Math.round(Math.max(-1f,Math.min(1f,sample))*32767f);
      le16(out,pcm);
    }
    return out.toByteArray();
  }
  @Override public synchronized void close(){engine.release();}
}
