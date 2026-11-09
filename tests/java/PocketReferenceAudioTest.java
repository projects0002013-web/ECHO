import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Arrays;
import org.echo.aac.PocketReferenceAudio;

public class PocketReferenceAudioTest {
    private static void put16(byte[] b,int p,int v){b[p]=(byte)v;b[p+1]=(byte)(v>>>8);}
    private static void put32(byte[] b,int p,int v){put16(b,p,v);put16(b,p+2,v>>>16);}
    private static byte[] audio(int seconds,int rate,int channels,int bitDepth,int amplitude){
        int blockAlign=channels*(bitDepth/8), size=seconds*rate*blockAlign;
        byte[] wav=new byte[44+size];
        System.arraycopy("RIFF".getBytes(java.nio.charset.StandardCharsets.US_ASCII),0,wav,0,4);
        put32(wav,4,wav.length-8);
        System.arraycopy("WAVEfmt ".getBytes(java.nio.charset.StandardCharsets.US_ASCII),0,wav,8,8);
        put32(wav,16,16);put16(wav,20,1);put16(wav,22,channels);
        put32(wav,24,rate);put32(wav,28,rate*blockAlign);
        put16(wav,32,blockAlign);put16(wav,34,bitDepth);
        System.arraycopy("data".getBytes(java.nio.charset.StandardCharsets.US_ASCII),0,wav,36,4);
        put32(wav,40,size);
        if(bitDepth==16)for(int i=44;i<wav.length;i+=2)put16(wav,i,amplitude);
        return wav;
    }
    private static void ok(boolean condition,String label){if(!condition)throw new AssertionError(label);}
    private static void invalid(byte[] data,String label){
        try{PocketReferenceAudio.decode(data);throw new AssertionError("Accepted invalid "+label);}
        catch(IOException expected){ }
    }
    public static void main(String[] args) throws Exception{
        for(int rate:new int[]{8000,16000,24000,44100,48000,96000})
            ok(PocketReferenceAudio.decode(audio(6,rate,1,16,2048)).sampleRate==rate,"sample rate "+rate);
        byte[] wrongByteRate=audio(6,16000,1,16,2048);put32(wrongByteRate,28,1);invalid(wrongByteRate,"byte rate");
        byte[] valid=audio(7,16000,1,16,2048);
        PocketReferenceAudio ref=PocketReferenceAudio.decode(new ByteArrayInputStream(valid));
        ok(ref.samples.length==112000,"sample count");
        ok(ref.sampleRate==16000,"rate");
        ok(ref.durationSeconds==7,"duration");
        ok(Math.abs(ref.samples[0]-2048f/32768f)<0.00001,"PCM amplitude");
        // 16 kHz, 5 seconds: lower bound; 30 seconds: upper bound.
        ok(PocketReferenceAudio.decode(audio(5,16000,1,16,500)).samples.length==80000,"min length");
        ok(PocketReferenceAudio.decode(audio(30,16000,1,16,500)).samples.length==480000,"max length");
        invalid(audio(4,16000,1,16,500),"too short");
        invalid(audio(31,16000,1,16,500),"too long");
        invalid(audio(7,16000,2,16,500),"stereo");
        invalid(audio(7,16000,1,8,0),"8bit");
        invalid(audio(7,16000,1,16,0),"silent");
        byte[] truncated=Arrays.copyOf(valid,valid.length-9);
        invalid(truncated,"truncated");
        byte[] trailing=Arrays.copyOf(valid,valid.length+10);
        invalid(trailing,"trailing data");
        byte[] malformed=valid.clone();put32(malformed,40,Integer.MAX_VALUE);
        invalid(malformed,"data chunk overflow");
        byte[] wrongFormat=valid.clone();put16(wrongFormat,20,3);
        invalid(wrongFormat,"float WAV");
        byte[] badRate=valid.clone();put32(badRate,24,0);
        invalid(badRate,"invalid rate");
        byte[] unknown=valid.clone();unknown[0]='X';invalid(unknown,"invalid RIFF");
        // Extended fmt/JUNK chunks must not be treated as audio content.
        byte[] withJunk=new byte[valid.length+12];
        System.arraycopy(valid,0,withJunk,0,36);
        System.arraycopy("JUNK".getBytes(java.nio.charset.StandardCharsets.US_ASCII),0,withJunk,36,4);
        put32(withJunk,40,4);withJunk[44]=12;withJunk[45]=34;
        System.arraycopy(valid,36,withJunk,48,valid.length-36);put32(withJunk,4,withJunk.length-8);
        ok(PocketReferenceAudio.decode(withJunk).samples.length==112000,"non-audio chunk");
        System.out.println("PocketReferenceAudio: all WAV validations passed.");
    }
}
