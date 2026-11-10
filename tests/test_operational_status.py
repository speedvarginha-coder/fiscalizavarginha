import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("status", Path(__file__).resolve().parents[1] / "scripts/publish-operational-status.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PublicTelemetry(unittest.TestCase):
    def test_public_payload_has_only_operational_allowlist(self):
        data = module.public_status({"finished_at": "2026-10-20T12:00:00Z", "coleta": "FALHA", "password": "secret", "log": "private"},
                                   {"checked_at": "2026-10-20T12:00:00Z", "status": "defasado", "destination": "private"})
        self.assertEqual(data["last_completed_run"]["coleta"], "FALHA")
        self.assertNotIn("password", str(data))
        self.assertNotIn("private", str(data))
        self.assertEqual(data["last_verified_deployment"]["status"], "SUCESSO")

    def test_financial_attempt_exposes_only_safe_operational_fields(self):
        financial={'executado_em':'2026-10-27T12:00:00Z','status':'parcial','fontes':{'diarias':'preservado','estadual':'ok','segredo':'private'},'token':'private'}
        result=module.public_status({}, {}, financial=financial)['financial_attempt']
        self.assertEqual(result['fontes'],{'diarias':'preservado','estadual':'ok'})
        self.assertNotIn('private',str(result))
