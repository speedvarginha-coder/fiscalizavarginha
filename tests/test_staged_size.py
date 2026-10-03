import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/check-staged-size.py'


class StagedSizeTests(unittest.TestCase):
    def test_checks_index_with_spaces_even_when_working_copy_is_small(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(['git', 'init', '-q', directory], check=True)
            document = root / 'arquivo com espacos.bin'
            document.write_bytes(b'x' * (20 * 1024 * 1024 + 1))
            subprocess.run(['git', 'add', '--', document.name], cwd=root, check=True)
            document.write_bytes(b'x')
            result = subprocess.run([sys.executable, str(SCRIPT)], cwd=root, capture_output=True)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIn(b'arquivo com espacos.bin', result.stdout)
            subprocess.run(['git', 'add', '--', document.name], cwd=root, check=True)
            result = subprocess.run([sys.executable, str(SCRIPT)], cwd=root, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
