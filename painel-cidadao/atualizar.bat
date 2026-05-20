@echo off
REM ============================================================
REM  Zela Varginha - Atualizar dados do painel
REM  Duplo clique para baixar os dados mais recentes da
REM  Camara, do Diario Oficial e do Portal de Transparencia.
REM ============================================================
chcp 65001 >nul
cd /d "%~dp0"

cls
echo.
echo  ================================================
echo   ZELA VARGINHA - Atualizando dados...
echo  ================================================
echo.

REM Verifica se Playwright esta disponivel
python -c "import playwright" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo  [!] Bibliotecas ainda nao instaladas.
  echo      Rode "INSTALAR.bat" primeiro.
  echo.
  pause
  exit /b 1
)

python coletor.py

if %ERRORLEVEL% EQU 0 (
  echo.
  echo  [✓] Dados atualizados. Abrindo o painel...
  start "" "%~dp0index.html"
) else (
  echo.
  echo  [X] Houve um erro. Confira a mensagem acima.
)

echo.
pause
