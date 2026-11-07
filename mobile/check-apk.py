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
print(json.dumps({'apk':str(apk),'bytes':apk.stat().st_size,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'current_offline_assets_checked':checked,'stylesheet':'executive-light.css'}))
