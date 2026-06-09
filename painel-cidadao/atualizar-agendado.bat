@echo off
REM ============================================================
REM  Fiscaliza Varginha - coleta AUTOMATICA (sem interacao)
REM
REM  Versao headless para o Task Scheduler:
REM  chama scripts\update-data.ps1 com vigia, validacao e rollback.
REM ============================================================
chcp 65001 >nul
cd /d "%~dp0\.."

echo ============================================== >> painel-cidadao\atualizar-agendado.log
echo [%date% %time%] Iniciando rotina segura >> painel-cidadao\atualizar-agendado.log

powershell -NoProfile -ExecutionPolicy Bypass -File scripts\update-data.ps1 -OnlyIfChanged -SkipTests -SkipPackage >> painel-cidadao\atualizar-agendado.log 2>&1

echo [%date% %time%] Rotina finalizada com codigo %ERRORLEVEL% >> painel-cidadao\atualizar-agendado.log
exit /b %ERRORLEVEL%
