import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("publisher", ROOT / "private/deploy_completo.py")
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)

class UploadTests(unittest.TestCase):
    def test_remote_file_changes_only_after_successful_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "index.html"
            source.write_text("validated", encoding="utf-8")
            ftp = Mock()
            with patch.object(publisher, "ensure_remote_directory"):
                publisher.upload(ftp, str(source), "/site/index.html")
                self.assertEqual(ftp.storbinary.call_args.args[0], "STOR /site/index.html.uploading")
                ftp.rename.assert_called_once_with("/site/index.html.uploading", "/site/index.html")
                ftp.reset_mock()
                ftp.storbinary.side_effect = OSError("interrupted")
                with self.assertRaises(OSError):
                    publisher.upload(ftp, str(source), "/site/index.html")
                ftp.rename.assert_not_called()

if __name__ == "__main__":
    unittest.main()
