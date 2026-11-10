"""Uma rejeição de procedência não deve destruir o pacote anterior."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SHELL = shutil.which("pwsh") or shutil.which("powershell")
ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(SHELL, "PowerShell indisponível")
class PackagePreflight(unittest.TestCase):
    def test_missing_git_provenance_preserves_previous_stage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "scripts").mkdir()
            (root / "painel-cidadao").mkdir()
            previous = root / "dist/painel-cidadao"
            previous.mkdir(parents=True)
            marker = previous / "release.json"
            marker.write_text('{"previous":true}', encoding="utf-8")
            script = root / "scripts/package-deploy.ps1"
            shutil.copyfile(ROOT / "scripts/package-deploy.ps1", script)
            result = subprocess.run([SHELL, "-NoProfile", "-File", str(script), "-AllowDirty"],
                                    capture_output=True, timeout=30)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(marker.exists())
            self.assertEqual(marker.read_text(encoding="utf-8"), '{"previous":true}')
