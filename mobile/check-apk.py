"""Verify the APK really contains the current offline design and scripts."""
from pathlib import Path
import hashlib,json,re,runpy,sys,zipfile
root=Path(__file__).resolve().parent.parent
apk=Path(sys.argv[1])
files=runpy.run_path(str(root/'mobile/package-web.py'))['FILES']
with zipfile.ZipFile(apk) as z:
 assert z.testzip() is None,'Corrupt APK entry'
 index=z.read('assets/www/index.html').decode()
 assert re.findall(r'<link[^>]*href="([^"]+)"[^>]*rel="stylesheet"',index)==['executive-light.css'],'Wrong CSS in APK'
 checked=0
 for name in files+['locales/'+p.name for p in (root/'locales').glob('*.json')]+['fonts/'+p.name for p in (root/'fonts').glob('*.woff2')]:
  assert z.read('assets/www/'+name)==(root/name).read_bytes(),'Stale asset: '+name
  checked+=1
 assert not any(n.startswith('assets/www/') and n.endswith(('.wav','.onnx','.pt')) for n in z.namelist()),'Unexpected private audio/model in APK'
 # Real offline model belongs in bundled app assets, not private user recordings.
 model_root='assets/pockettts/'
 hashes=json.loads(z.read(model_root+'hashes.json'))
 expected={'lm_flow.int8.onnx','lm_main.int8.onnx','encoder.onnx',
           'decoder.int8.onnx','text_conditioner.onnx','vocab.json',
           'token_scores.json','LICENSE'}
 assert set(hashes)==expected,'Unexpected/missing PocketTTS model files'
 for filename,digest in hashes.items():
  calculated=hashlib.sha256()
  size=0
  with z.open(model_root+filename) as stream:
   for block in iter(lambda:stream.read(1024*1024),b''):
    calculated.update(block)
    size+=len(block)
  assert size>0 and calculated.hexdigest()==digest,'PocketTTS model mismatch: '+filename
 jni=set()
 for abi in ('arm64-v8a','x86_64'):
  required={'lib/'+abi+'/'+n for n in ('libsherpa-onnx-jni.so','libonnxruntime.so')}
  assert required.issubset(z.namelist()),'Missing real JNI/ONNX runtime for '+abi
  jni.update(required)
 assert not any(n.endswith('personal.wav') or 'user-voice' in n.lower() for n in z.namelist()),'Private voice bundled into APK'
print(json.dumps({'apk':str(apk),'bytes':apk.stat().st_size,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'current_offline_assets_checked':checked,'stylesheet':'executive-light.css','pocket_model_files':8,'android_jni_libraries':sorted(jni)}))
