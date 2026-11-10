import subprocess
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which('powershell'), 'Teste do executor Windows requer PowerShell')
class FinancialTimeoutTests(unittest.TestCase):
    def test_timeout_preserva_fonte_sem_encerrar_outros_processos(self):
        # Carrega somente a função, sem disparar coleta ou publicação.
        with tempfile.TemporaryDirectory(prefix='fiscaliza-timeout-') as tmp:
            folder = Path(tmp)
            (folder / 'wait.py').write_text('import time\ntime.sleep(30)\n', encoding='utf-8')
            script = folder / 'test.ps1'
            source = str(ROOT / 'scripts/update-financial-data.ps1').replace("'", "''")
            script.write_text(f"""
$ErrorActionPreference='Stop'
$ast=[System.Management.Automation.Language.Parser]::ParseFile('{source}',[ref]$null,[ref]$null)
$fn=$ast.Find({{param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-FinancialStep'}},$true)
. ([scriptblock]::Create($fn.Extent.Text))
$logDir=$PSScriptRoot
function Write-FinancialLog {{param($Message) Write-Host $Message}}
$code=Invoke-FinancialStep -Label 'Teste isolado' -FilePath 'python' -Arguments @('wait.py') -WorkingDirectory $PSScriptRoot -AcceptedExitCodes @(0,2) -TimeoutSeconds 1
if ($code -ne 2) {{throw 'Timeout nao preservou a fonte'}}
Write-Host 'TIMEOUT_PRESERVADO'
$npmCode=Invoke-FinancialStep -Label 'Teste npm' -FilePath 'npm.cmd' -Arguments @('--version') -WorkingDirectory $PSScriptRoot -TimeoutSeconds 15
if ($npmCode -ne 0) {{throw 'Execucao direta do npm falhou'}}
Write-Host 'NPM_DIRETO_OK'
""", encoding='utf-8-sig')
            result=subprocess.run(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',str(script)],capture_output=True,text=True,timeout=35)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertIn('TIMEOUT_PRESERVADO',result.stdout)
            self.assertIn('NPM_DIRETO_OK',result.stdout)
