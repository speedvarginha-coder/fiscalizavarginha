import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "painel-cidadao"))
from validar_schemas_dados import SourceDomain, MonitorSource


class TestSourceStatusSchema(unittest.TestCase):
    def test_fonte_defasada_e_monitor_sao_estados_validos(self):
        source = SourceDomain(label="Fonte", status="stale", max_age_days=7)
        monitor = MonitorSource(id="fonte", label="Fonte", status=source.status, reason="Coleta excedeu a janela.")
        self.assertEqual(monitor.status, "stale")
