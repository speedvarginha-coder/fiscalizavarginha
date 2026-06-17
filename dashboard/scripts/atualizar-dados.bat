@echo off
REM ====================================================================
REM  Fiscaliza Varginha - atualizacao automatica dos dados reais
REM
REM  Roda o scraper do Portal da Transparencia Betha e regrava
REM  src/data/categoriasGasto.real.json com Prefeitura + Camara.
REM
REM  Agendado via Task Scheduler (ver scripts/README.md).
REM  Log gravado em scripts/atualizar-dados.log
REM ====================================================================

setlocal
cd /d "%~dp0.."

echo ============================================== >> scripts\atualizar-dados.log
echo [%date% %time%] Iniciando coleta >> scripts\atualizar-dados.log

node scripts\scrape-betha.mjs >> scripts\atualizar-dados.log 2>&1

if %errorlevel% neq 0 (
  echo [%date% %time%] ERRO: scraper retornou codigo %errorlevel% >> scripts\atualizar-dados.log
) else (
  echo [%date% %time%] OK: dados atualizados >> scripts\atualizar-dados.log
)

endlocal
