@echo off
setlocal
cd /d "%~dp0"
where node
if errorlevel 1 (
  echo Node.js nao foi encontrado no PATH.
  pause
  exit /b 1
)
node launcher.js
set ERR=%ERRORLEVEL%
echo.
echo Azurecord launcher terminou com codigo %ERR%.
echo Log: %TEMP%\azurecord-launcher.log
if exist "%TEMP%\azurecord-launcher.log" type "%TEMP%\azurecord-launcher.log"
pause
exit /b %ERR%
