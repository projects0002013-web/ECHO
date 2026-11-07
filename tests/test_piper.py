"""Protocol/privacy checks without downloading an optional Piper model."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import threading
import types
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer

fake = types.ModuleType('piper')
fake.PiperVoice = type('PiperVoice', (), {})
with patch.dict(sys.modules, {'piper': fake}):
    spec = importlib.util.spec_from_file_location('tested_piper_bridge', Path(__file__).resolve().parents[1] / 'piper_bridge.py')
    bridge = importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)

class PiperProtocol(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),bridge.Handler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.url=f'http://127.0.0.1:{cls.server.server_port}'
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()
    def request(self,path='/api/voices',data=None,headers=None,method=None):
        req=Request(self.url+path,data=data,headers=headers or {},method=method)
        try:return urlopen(req)
        except HTTPError as error:return error
    def test_local_voices_and_exact_cors(self):
        with patch.object(bridge,'voices',return_value=[{'id':'local'}]):
            with self.request(headers={'Origin':'http://localhost:8000'}) as response:
                self.assertEqual(response.status,200)
                self.assertEqual(response.headers['Access-Control-Allow-Origin'],'http://localhost:8000')
                self.assertEqual(json.load(response),[{'id':'local'}])
    def test_remote_origin_cannot_infer_or_read_models(self):
        for method in ['GET','POST','OPTIONS']:
            with self.request(headers={'Origin':'https://example.com'},method=method) as response:
                self.assertEqual(response.status,403)
                self.assertIsNone(response.headers.get('Access-Control-Allow-Origin'))
    def test_dns_rebinding_is_rejected(self):
        with self.request(headers={'Host':'untrusted.example'}) as response:self.assertEqual(response.status,403)
    def test_synthesis_and_private_error(self):
        body=json.dumps({'voice':'local','text':'Привет'}).encode()
        with patch.object(bridge,'voices',return_value=[{'id':'local'}]),patch.object(bridge,'synthesize',return_value=b'RIFF-local-test-audio'):
            with self.request('/api/tts',body,{'Content-Type':'application/json'}) as response:
                self.assertEqual(response.status,200);self.assertEqual(response.headers['Content-Type'],'audio/wav')
        with patch.object(bridge,'voices',return_value=[{'id':'local'}]),patch.object(bridge,'synthesize',side_effect=RuntimeError('private spoken text')):
            with self.request('/api/tts',body,{'Content-Type':'application/json'}) as response:
                self.assertEqual(response.status,503);self.assertNotIn(b'private spoken text',response.read())
    def test_invalid_content_and_unknown_model(self):
        with self.request('/api/tts',b'bad',{'Content-Type':'text/plain'}) as response:self.assertEqual(response.status,415)
        with patch.object(bridge,'voices',return_value=[]):
            with self.request('/api/tts',b'{"voice":"missing","text":"test"}',{'Content-Type':'application/json'}) as response:self.assertEqual(response.status,400)

if __name__=='__main__':unittest.main(verbosity=2)
