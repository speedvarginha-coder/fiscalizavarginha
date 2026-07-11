@echo off
REM =========================================================================
REM Automação do Pipeline - Fiscaliza Varginha
REM Este script é acionado pelo Agendador de Tarefas do Windows.
REM Ele roda a raspagem de dados, envia para a Hostinger e dispara WhatsApp.
REM =========================================================================

cd /d "%~dp0"
powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "scripts\update-data.ps1"
