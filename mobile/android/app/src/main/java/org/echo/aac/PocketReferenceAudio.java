package org.echo.aac;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Validates and decodes a user's own PCM WAV reference for offline voice conditioning.
 *
 * No microphone access, network, external file writes or model inference.
 * The returned normalized mono floats can later be passed to the PocketTTS
 * referenceAudio field in sherpa-onnx's GenerationConfig.
 */
public final class PocketReferenceAudio {
    public static final int MAX_BYTES = 8 * 1024 * 1024;
    public static final int MIN_SECONDS = 5;
    public static final int MAX_SECONDS = 30;

    public final float[] samples;
    public final int sampleRate;
    public final double durationSeconds;

    private PocketReferenceAudio(float[] samples, int sampleRate) {
        this.samples = samples;
        this.sampleRate = sampleRate;
        this.durationSeconds = (double) samples.length / sampleRate;
    }

    private static long u32(byte[] data, int at) {
        return ((long)data[at] & 255L) | (((long)data[at+1] & 255L) << 8) |
            (((long)data[at+2] & 255L) << 16) | (((long)data[at+3] & 255L) << 24);
    }
    private static int u16(byte[] data, int at) {
        return (data[at] & 255) | ((data[at+1] & 255) << 8);
    }
    private static boolean tag(byte[] data, int at, String value) {
        if (at < 0 || at + 4 > data.length) return false;
        for (int i=0;i<4;i++) if ((data[at+i] & 255)!=value.charAt(i)) return false;
        return true;
    }

    public static PocketReferenceAudio decode(InputStream input) throws IOException {
        if (input == null) throw new IOException("No WAV reference.");
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[16384];
        int size = 0, n;
        while ((n=input.read(buffer)) != -1) {
            if (n == 0) continue;
            size += n;
            if (size > MAX_BYTES) throw new IOException("Voice reference exceeds 8 MB.");
            output.write(buffer,0,n);
        }
        return decode(output.toByteArray());
    }

    public static PocketReferenceAudio decode(byte[] wav) throws IOException {
        if (wav == null || wav.length < 44 || wav.length > MAX_BYTES ||
                !tag(wav,0,"RIFF") || !tag(wav,8,"WAVE"))
            throw new IOException("Expected RIFF/WAVE PCM reference.");
        long declared = u32(wav,4);
        if (declared != wav.length-8L) throw new IOException("Truncated or trailing WAV bytes.");

        int format = -1, channels = 0, rate = 0, bits = 0, blockAlign = 0;
        long byteRate = 0;
        int dataAt = -1, dataSize = 0;
        int pos = 12;
        while (pos + 8 <= wav.length) {
            long len = u32(wav,pos+4);
            long end = (long)pos + 8 + len;
            if (end > wav.length || end > Integer.MAX_VALUE)
                throw new IOException("Invalid WAV chunk length.");
            if (tag(wav,pos,"fmt ")) {
                if (format != -1 || len < 16) throw new IOException("Invalid WAV format chunk.");
                format = u16(wav,pos+8);
                channels = u16(wav,pos+10);
                rate = (int)u32(wav,pos+12);
                byteRate = u32(wav,pos+16);
                blockAlign = u16(wav,pos+20);
                bits = u16(wav,pos+22);
            } else if (tag(wav,pos,"data")) {
                if (dataAt != -1) throw new IOException("Duplicate WAV audio data.");
                dataAt = pos+8;
                dataSize = (int)len;
            }
            pos = (int)(end + (len & 1L));
        }
        if (pos != wav.length || format != 1 || channels != 1 || bits != 16 ||
                rate < 8000 || rate > 96000 || blockAlign != 2 || byteRate != rate * 2L ||
                dataAt < 0 || dataSize <= 0 || (dataSize & 1) != 0)
            throw new IOException("Reference must be mono 16-bit PCM WAV (8–96 kHz).");

        long frames = dataSize / 2L;
        if (frames < (long)rate * MIN_SECONDS || frames > (long)rate * MAX_SECONDS)
            throw new IOException("Record a 5–30 second voice sample.");
        float[] samples = new float[(int)frames];
        double energy = 0;
        for (int i=0;i<samples.length;i++) {
            int signed = (short)u16(wav,dataAt + i*2);
            float v = signed / 32768f;
            samples[i] = v;
            energy += (double)v*v;
        }
        if (energy/samples.length < 0.000001)
            throw new IOException("The voice sample is silent or too quiet.");
        return new PocketReferenceAudio(samples,rate);
    }
}
