@echo off
chcp 65001 >nul
echo TSU Ainet App - lokaler Start
if not exist package.json (
  echo FEHLER: package.json wurde nicht gefunden.
  echo Bitte diese Datei direkt im Projektordner starten.
  pause
  exit /b 1
)
call npm.cmd install
if errorlevel 1 goto error
call npm.cmd run dev
exit /b 0
:error
echo.
echo Installation oder Start fehlgeschlagen.
pause
exit /b 1
