"""Package the existing offline app; no voices, models or user data are bundled."""
from pathlib import Path
import shutil,re
ROOT=Path(__file__).resolve().parent.parent
FILES=['index.html','executive-light.css','style.css','features.css','script.js','features.js','i18n.js','accessibility.js','backup.js','recorder-worklet.js','mobile-voice.js','executive.js','offline-voice.js','sw.js','manifest.json','icon-192.png','icon-512.png','cover.png']
def package():
 for target in [ROOT/'mobile/android/app/src/main/assets/www',ROOT/'mobile/ios/www']:
  target.mkdir(parents=True,exist_ok=True)
  for name in FILES:
   source=ROOT/name
   if not source.is_file():raise FileNotFoundError(name)
   shutil.copy2(source,target/name)
  for name in ['fonts','locales']:shutil.copytree(ROOT/name,target/name,dirs_exist_ok=True)
  index=(target/'index.html').read_text()
  assert 'executive-light.css' in index
  assert 'href="style.css"' not in index and 'href="features.css"' not in index
  for asset in re.findall(r'"\./([^"?]+)"',(target/'sw.js').read_text().split('self.addEventListener')[0]):
   if not (target/asset).is_file():raise FileNotFoundError('Cached asset missing: '+asset)
  print('Packaged Executive Light:',target)
if __name__=='__main__':package()
