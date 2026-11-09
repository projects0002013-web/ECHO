package org.echo.aac;

import android.content.Context;
import android.content.res.AssetManager;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;

/** Offline first-run installation of bundled PocketTTS model, verified before inference. */
public final class PocketModelInstaller {
    private PocketModelInstaller() {}
    private static final String[] FILES={
        "lm_flow.int8.onnx","lm_main.int8.onnx","encoder.onnx",
        "decoder.int8.onnx","text_conditioner.onnx","vocab.json",
        "token_scores.json","LICENSE"
    };
    public static boolean bundled(Context context) {
        try{
            return Arrays.asList(context.getAssets().list("pockettts")).contains("hashes.json");
        }catch(IOException error){return false;}
    }
    private static String hex(byte[] input){
        StringBuilder out=new StringBuilder();
        for(byte b:input)out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
        return out.toString();
    }
    private static byte[] readManifest(AssetManager assets)throws IOException{
        try(InputStream in=assets.open("pockettts/hashes.json")){
            byte[] manifest=new byte[4096];int off=0,n;
            while((n=in.read(manifest,off,manifest.length-off))!=-1){
                if(n==0)continue;
                off+=n;
                if(off==manifest.length)throw new IOException("Invalid PocketTTS manifest");
            }
            return Arrays.copyOf(manifest,off);
        }
    }
    private static boolean valid(File dir,JSONObject hashes)throws Exception{
        for(String name:FILES){
            File file=new File(dir,name);
            if(!file.isFile() || !hashes.has(name))return false;
            MessageDigest digest=MessageDigest.getInstance("SHA-256");
            try(InputStream in=new java.io.FileInputStream(file)){
                byte[] buffer=new byte[65536];int n;
                while((n=in.read(buffer))!=-1)if(n>0)digest.update(buffer,0,n);
            }
            if(!hex(digest.digest()).equalsIgnoreCase(hashes.getString(name)))return false;
        }
        return true;
    }
    private static void erase(File path) throws IOException{
        if(!path.exists())return;
        if(path.isDirectory()){
            File[] children=path.listFiles();
            if(children==null)throw new IOException("Cannot inspect model directory");
            for(File child:children)erase(child);
        }
        if(!path.delete())throw new IOException("Cannot clear old model");
    }
    public static synchronized File ensureInstalled(Context context)throws Exception {
        AssetManager assets=context.getAssets();
        if(!bundled(context))throw new IOException("PocketTTS model is not bundled in this APK");
        JSONObject manifest=new JSONObject(new String(readManifest(assets),StandardCharsets.UTF_8));
        File installed=new File(context.getFilesDir(),"pockettts");
        if(installed.isDirectory() && valid(installed,manifest))return installed;
        File staging=new File(context.getFilesDir(),"pockettts-stage");
        erase(staging);
        if(context.getFilesDir().getUsableSpace()<250L*1024*1024)
            throw new IOException("Not enough free storage for offline PocketTTS");
        if(!staging.mkdirs())throw new IOException("Cannot create model installation folder");
        try{
            for(String name:FILES) {
                if(!manifest.has(name))throw new IOException("Missing model checksum");
                MessageDigest digest=MessageDigest.getInstance("SHA-256");
                long count=0;
                try(InputStream in=assets.open("pockettts/"+name);
                    FileOutputStream out=new FileOutputStream(new File(staging,name))){
                    byte[] buffer=new byte[65536];int n;
                    while((n=in.read(buffer))!=-1){
                        if(n==0)continue;
                        count+=n;if(count>90L*1024*1024)throw new IOException("Oversized model component");
                        digest.update(buffer,0,n);out.write(buffer,0,n);
                    }
                    out.getFD().sync();
                }
                if(!hex(digest.digest()).equalsIgnoreCase(manifest.getString(name)))
                    throw new IOException("PocketTTS model checksum mismatch");
            }
            if(!valid(staging,manifest))throw new IOException("Model verification failed");
            erase(installed);
            if(!staging.renameTo(installed))throw new IOException("Cannot activate model");
            return installed;
        }finally{
            if(staging.exists())erase(staging);
        }
    }
}
