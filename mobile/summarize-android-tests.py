#!/usr/bin/env python3
"""Fail CI if genuine Android inference tests did not execute, or were skipped."""
from pathlib import Path
import os
import xml.etree.ElementTree as ET
root=Path(__file__).resolve().parent/'android/app/build/outputs/androidTest-results'
expected={
    'realNativeInferenceResamplingCancellationAndPlayback',
    'corruptedModelIsRejectedAndRecoveredWithoutTouchingUserData',
    'serviceSerializesRequestsAndSurvivesStop',
    'savedSampleConsentNewTextAndRealNativeWav',
}
tests=[]
for report in root.rglob('TEST-*.xml'):
    tests.extend(ET.parse(report).getroot().iter('testcase'))
seen={test.attrib['name'] for test in tests}
lines=['## Real offline Android JNI/ONNX integration',
       'Executed on an Android x86_64 emulator with Wi-Fi and mobile data disabled.',
       'Synthetic reference samples exercise inference, not voice likeness.',
       '', '| Actual test | Time (seconds) |', '|---|---|']
for test in tests:
    lines.append('| '+test.attrib['name']+' | '+test.attrib.get('time','?')+' |')
    for tag in ('failure','error','skipped'):
        detail=test.find(tag)
        if detail is not None:lines.extend(['', '```text', (detail.text or repr(detail.attrib))[:8000], '```', ''])
lines.extend(['','Each listed test must pass without skips. Physical Android quality, speed and microphone acceptance remain unverified.'])
summary='\n'.join(lines)+'\n'
print(summary)
if os.environ.get('GITHUB_STEP_SUMMARY'):
    with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as out:out.write(summary)

assert expected <= seen, 'Android tests missing: '+repr(expected-seen)
for test in tests:
    assert not any(test.find(tag) is not None for tag in ('failure','error','skipped')), test.attrib
