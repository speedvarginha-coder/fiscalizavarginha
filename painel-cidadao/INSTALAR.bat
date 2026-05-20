@echo off
REM ============================================================
REM  Zela Varginha - INSTALADOR (rodar UMA vez, na primeira vez)
REM
REM  Instala as dependencias necessarias para baixar os dados
REM  da Prefeitura e da Camara automaticamente.
REM ============================================================
chcp 65001 >nul
cd /d "%~dp0"

cls
echo.
echo  ================================================
echo   ZELA VARGINHA - Instalador
echo  ================================================
echo.

REM Verifica Python
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo  [X] Python nao esta instalado.
  echo.
  echo  Por favor:
  echo    1) Abra: https://www.python.org/downloads/
  echo    2) Baixe e instale o Python 3.10 ou mais novo
  echo    3) IMPORTANTE: marque "Add Python to PATH"
  echo    4) Execute este instalador novamente.
  echo.
  pause
  exit /b 1
)

echo  [✓] Python encontrado.
echo.

echo  Instalando bibliotecas (pode levar alguns minutos)...
echo.
python -m pip install --upgrade pip --quiet
python -m pip install playwright --quiet
if %ERRORLEVEL% NEQ 0 (
  echo  [X] Falha ao instalar playwright.
  pause
  exit /b 1
)

echo  [✓] Playwright instalado.
echo.

echo  Baixando navegador headless (Chromium ~150 MB)...
echo  ^(so vai precisar UMA vez^)
echo.
python -m playwright install chromium
if %ERRORLEVEL% NEQ 0 (
  echo  [X] Falha ao instalar Chromium.
  pause
  exit /b 1
)

echo.
echo  ================================================
echo   Instalacao concluida com sucesso!
echo  ================================================
echo.
echo  Agora voce pode:
echo    - duplo-clique em "atualizar.bat" para baixar
echo      os dados mais recentes
echo    - duplo-clique em "index.html" para abrir o
echo      painel no navegador
echo.

REM Pergunta se quer baixar agora
choice /c SN /m "Quer baixar os dados agora"
if %ERRORLEVEL% EQU 1 (
  call atualizar.bat
)

pause
