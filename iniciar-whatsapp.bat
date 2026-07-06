@echo off
title Servidor WhatsApp - Fiscaliza Varginha
echo ======================================================
echo Iniciando Servidor WhatsApp Local (Gratis)
echo ======================================================
cd /d "%~dp0\painel-cidadao\whatsapp-bridge"
node server.js
pause
