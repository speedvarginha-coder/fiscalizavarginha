import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "painel-cidadao"))
from coleta_frescor import registrar_frescor
import coletor
import coletor_federal


class FrescorTests(unittest.TestCase):
    def test_primeira_preservacao_nao_inventa_data(self):
        result = registrar_frescor({}, {"atualizado_em": "2026-09-01"}, {"frota": "preservado"}, "2026-09-14")
        self.assertIsNone(result["coleta_frescor"]["datasets"]["frota"]["last_complete_at"])

    def test_sucesso_seguido_de_falha_preserva_data_e_dados(self):
        original = registrar_frescor({"frota": [{"id": 1}]}, {}, {"frota": "coleta_atual"}, "2026-09-01")
        for status in ("partial", "preservado", "failed", "unknown"):
            result = registrar_frescor({"frota": original["frota"]}, original, {"frota": status}, "2026-09-14")
            meta = result["coleta_frescor"]["datasets"]["frota"]
            self.assertEqual(meta["last_complete_at"], "2026-09-01")
            self.assertEqual(meta["checked_at"], "2026-09-14")
            self.assertEqual(result["frota"], original["frota"])

    def test_recuperacao_avanca_somente_particao_completa(self):
        original = registrar_frescor({}, {}, {"contratos": "ok", "frota": "ok"}, "2026-09-01")
        result = registrar_frescor({}, original, {"contratos": "ok", "frota": "preservado"}, "2026-09-14")
        self.assertEqual(result["coleta_frescor"]["datasets"]["contratos"]["last_complete_at"], "2026-09-14")
        self.assertEqual(result["coleta_frescor"]["datasets"]["frota"]["last_complete_at"], "2026-09-01")

    def test_gravacao_prefeitura_mantem_historico_entre_ciclos(self):
        with TemporaryDirectory() as directory, patch.object(coletor, "DATA", Path(directory)):
            payload = {"contratos_status_coleta": "coleta_atual", "obras_status_coleta": "coleta_atual", "frota_status_coleta": "coleta_atual"}
            coletor._save("prefeitura.json", payload)
            first = payload["coleta_frescor"]["datasets"]["frota"]["last_complete_at"]
            preserved = {**payload, "frota_status_coleta": "preservada_por_resposta_betha_vazia"}
            coletor._save("prefeitura.json", preserved)
            self.assertEqual(preserved["coleta_frescor"]["datasets"]["frota"]["last_complete_at"], first)

    def test_federal_fallback_nao_reutiliza_status_ok_como_coleta_nova(self):
        with TemporaryDirectory() as directory, patch.object(coletor_federal, "DATA", Path(directory)):
            original = {"status_fontes": {name: {"status": "ok"} for name in ("emendas", "convenios", "transferencias_especiais", "ceis")}}
            coletor_federal.salvar(original)
            first = original["coleta_frescor"]["datasets"]["emendas"]["last_complete_at"]
            preserved = coletor_federal._fallback(silencioso=True)
            coletor_federal.salvar(preserved)
            self.assertEqual(preserved["coleta_frescor"]["datasets"]["emendas"]["status"], "preservado")
            self.assertEqual(preserved["coleta_frescor"]["datasets"]["emendas"]["last_complete_at"], first)

    def test_ciclo_principal_tambem_registra_frescor_federal(self):
        with TemporaryDirectory() as directory, patch.object(coletor, "DATA", Path(directory)):
            payload = {"status_fontes": {"emendas": {"status": "ok"}}}
            coletor._save("federal.json", payload)
            datasets = payload["coleta_frescor"]["datasets"]
            self.assertIsNotNone(datasets["emendas"]["last_complete_at"])
            self.assertIsNone(datasets["convenios"]["last_complete_at"])
