"""Gravidade do ciclo: WhatsApp caido nao pode reprovar coleta e deploy bons.

Ate 27/07/2026 uma sessao de WhatsApp expirada fazia `update-data.ps1` sair com
codigo 1, o mesmo de falha de deploy. O agendador do Windows marcava a tarefa
diaria inteira como erro mesmo com o site publicado corretamente, e uma falha
real de deploy ficava indistinguivel de um QR Code vencido.

A separacao so e segura porque o alerta operacional NAO depende do exit code:
o watchdog le `whatsapp` de pipeline_last_result.json. Estes testes travam as
duas pontas.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UPDATE_PS1 = ROOT / "scripts" / "update-data.ps1"
HEALTH_MJS = ROOT / "scripts" / "check-pipeline-health.mjs"


class TestExitCodesUpdateData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.texto = UPDATE_PS1.read_text(encoding="utf-8", errors="ignore")

    def test_deploy_falho_continua_fatal(self):
        """Deploy quebrado significa site com dado velho: tem que reprovar."""
        self.assertRegex(
            self.texto,
            r'if \(\$deployStatus -eq "FALHA"\) \{ exit 1 \}',
            "falha de deploy deve continuar saindo com codigo 1",
        )

    def test_whatsapp_falho_nao_usa_o_codigo_de_deploy(self):
        """Exit 4: sinaliza sem se confundir com falha critica."""
        self.assertIn("exit 4", self.texto)
        # a condicao antiga juntava os dois num unico exit 1
        self.assertNotRegex(
            self.texto,
            r'\$deployStatus -eq "FALHA" -or \$whatsAppStatus -eq "FALHA".*exit 1',
            "deploy e WhatsApp nao podem voltar a compartilhar o mesmo exit code",
        )

    def test_os_tres_codigos_sao_distintos(self):
        codigos = re.findall(r"^\s*(?:if \([^)]*\) \{ )?exit (\d+)", self.texto, re.M)
        finais = {c for c in codigos if c in {"0", "1", "4"}}
        self.assertEqual(
            finais,
            {"0", "1", "4"},
            f"esperado 0/1/4 como codigos de resultado do ciclo; achado: {sorted(finais)}",
        )

    def test_a_escolha_esta_explicada_no_codigo(self):
        """Sem o porque escrito, alguem 'simplifica' isso de volta em seis meses."""
        self.assertIn("nao critico", self.texto)


class TestAlertaIndependeDoExitCode(unittest.TestCase):
    """O que torna o exit 4 seguro: o alerta vem do estado, nao do codigo."""

    @classmethod
    def setUpClass(cls):
        cls.texto = HEALTH_MJS.read_text(encoding="utf-8", errors="ignore")

    def test_watchdog_le_o_estado_json_do_pipeline(self):
        self.assertIn("pipeline_last_result.json", self.texto)

    def test_watchdog_dispara_com_status_falha(self):
        self.assertRegex(
            self.texto,
            r'whatsappStatus === "FALHA"',
            "o alerta de WhatsApp deve continuar disparando pelo status registrado",
        )


if __name__ == "__main__":
    unittest.main()
