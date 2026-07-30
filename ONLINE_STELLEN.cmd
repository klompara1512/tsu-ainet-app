@echo off
chcp 65001 >nul
echo TSU Ainet App - Build und Firebase Hosting
if not exist package.json (
  echo FEHLER: package.json wurde nicht gefunden.
  echo Bitte diese Datei direkt im Projektordner starten.
  pause
  exit /b 1
)
call npm.cmd install
if errorlevel 1 goto error
call npm.cmd run build
if errorlevel 1 goto error
call firebase.cmd deploy --only hosting
if errorlevel 1 goto error
echo.
echo Die App wurde erfolgreich online gestellt.
pause
exit /b 0
:error
echo.
echo Build oder Deployment fehlgeschlagen.
pause
exit /b 1
