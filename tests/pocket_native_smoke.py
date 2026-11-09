"""Real native Pocket inference, optional external runtime/model; never a phone claim."""
import argparse,array,hashlib,json,math,os,struct,subprocess,tempfile,time,wave
from pathlib import Path

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--binary',type=Path,required=True);p.add_argument('--model-dir',type=Path,required=True);p.add_argument('--reference',type=Path);p.add_argument('--owner-consent',action='store_true');args=p.parse_args()
 if args.reference and not args.owner_consent:p.error('A real reference requires --owner-consent and ownership permission')
 manifest=json.loads(Path('native/pocket-model.json').read_text())
 for name,entry in manifest['files'].items():
  file=args.model_dir/name
  assert file.is_file(),f'Missing local model asset: {name}'
  assert hashlib.sha256(file.read_bytes()).hexdigest()==entry['sha256'],f'Local asset checksum mismatch: {name}'
 with tempfile.TemporaryDirectory(prefix='echo-pocket-test-') as temp:
  root=Path(temp);reference=args.reference or root/'synthetic-reference.wav'
  if not args.reference:
   with wave.open(str(reference),'wb') as f:
    f.setparams((1,2,16000,0,'NONE','not compressed'));f.writeframes(b''.join(struct.pack('<h',int(4000*math.sin(2*math.pi*220*i/16000))) for i in range(7*16000)))
  before=hashlib.sha256(reference.read_bytes()).hexdigest();text=root/'new-text.txt';text.write_text('This is a new sentence generated locally.');out=root/'new.wav'
  base=[str(args.binary.resolve()),str(args.model_dir.resolve()),str(reference.resolve()),str(text),str(out)]
  denied=subprocess.run(base+['--no-consent'],capture_output=True,timeout=10);assert denied.returncode!=0 and not out.exists()
  start=time.monotonic();r=subprocess.run(base+['--consent-own-voice'],capture_output=True,timeout=60);assert r.returncode==0, r.stderr.decode(errors='replace')
  elapsed=time.monotonic()-start
  with wave.open(str(out)) as f:
   channels=f.getnchannels();rate=f.getframerate();width=f.getsampwidth();duration=f.getnframes()/rate;frames=f.readframes(f.getnframes())
  assert channels==1 and width==2 and rate>0 and duration>0
  pcm=array.array('h',frames);rms=math.sqrt(sum(v*v for v in pcm)/len(pcm));assert rms>1
  assert hashlib.sha256(out.read_bytes()).hexdigest()!=before
  assert hashlib.sha256(reference.read_bytes()).hexdigest()==before
  # No existing WAV may be overwritten by a repeat invocation.
  repeated=subprocess.run(base+['--consent-own-voice'],capture_output=True,timeout=30);assert repeated.returncode!=0
  Path('.test-output').mkdir(exist_ok=True);Path('.test-output/pocket-real.wav').write_bytes(out.read_bytes())
  report={'real_native_cpu_inference':'passed','runtime':'sherpa-onnx 2.0.1 / Pocket int8','language':'en','reference':'owner-approved supplied WAV' if args.reference else 'synthetic test signal, not a human voice','wav_bytes':out.stat().st_size,'sample_rate':rate,'channels':channels,'duration_seconds':round(duration,3),'rms_pcm16':round(rms,2),'elapsed_seconds':round(elapsed,3),'consent_and_no_overwrite':'passed','android':'unrun','iphone':'unrun','voice_similarity':'unrun'}
  Path('.test-output/pocket-real.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':main()
