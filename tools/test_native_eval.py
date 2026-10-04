"""Validate the native arena boundary and owned map fixtures without loading EA assets."""
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("native_eval", Path(__file__).with_name("native-eval-server.py"))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)

class NativeEvalTests(unittest.TestCase):
    def config(self, mode="ra2"):
        return dict(mode=mode,a="r2qilin" if mode=="ra2" else "2tnk",b="htnk" if mode=="ra2" else "3tnk",count=3,reps=2,duration=30,candidate="focus",baseline="nearest",opponent="nearest")
    def test_boundary_rejects_unknown_code_paths_and_resource_exhaustion(self):
        for patch in ({"a":"../../secret"},{"candidate":"kite"},{"candidate":"deploy"},{"reps":7},{"count":True},{"duration":121},{"script":"arbitrary lua"},{"mode":"unknown"},{"a":"gayard"}):
            with self.subTest(patch=patch),self.assertRaises(ValueError):native.validate({**self.config(),**patch})
        self.assertEqual(native.validate(self.config()),self.config())
    def test_owned_map_format_and_policy_script_are_valid_for_both_modes(self):
        for mode in ("ra","ra2"):
            with tempfile.TemporaryDirectory() as directory:
                path=Path(directory)/"map";native.fixture(path,mode,self.config(mode),"focus",1)
                header=struct.unpack("<BHHIII",(path/"map.bin").read_bytes()[:17]);_,w,h,tiles,_,resources=header
                self.assertEqual(tiles,17);self.assertEqual(resources,17+w*h*3);self.assertEqual((path/"map.bin").stat().st_size,17+w*h*5)
                self.assertIn("mirror = true",(path/"arena.lua").read_text());self.assertNotIn("__CONFIG__",(path/"arena.lua").read_text())
                self.assertIn("FogCheckboxEnabled: False",(path/"arena-rules.yaml").read_text());self.assertEqual(len(list(path.iterdir())),5)
    def test_responses_exclude_processes_paths_requests_and_content(self):
        safe=native.public(dict(id="a",status="failed",rows=[],mode="ra2",process="secret",request={"path":"private"},cancelled=True))
        self.assertEqual(set(safe),{"id","status","rows","mode"});json.dumps(safe)
    def test_host_and_origin_guards_reject_public_sites_and_dns_rebinding(self):
        h=object.__new__(native.Handler)
        h.headers={"Host":"127.0.0.1:3462","Origin":"https://rtsai.net","X-RTSAI-Eval":"1"};self.assertFalse(h.allowed(True))
        h.headers["Origin"]="http://127.0.0.1:3460";self.assertTrue(h.allowed(True))
        h.headers["Host"]="attacker.example:3462";self.assertFalse(h.allowed(True))
        h.headers={"Host":"127.0.0.1:3462"};self.assertTrue(h.allowed());self.assertFalse(h.allowed(True))
if __name__=="__main__":unittest.main()
