@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 exit /b 1
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath 'node.exe' -ArgumentList 'backend\\server.js' -WorkingDirectory '%~dp0' -WindowStyle Hidden" >nul 2>&1
exit /b 0
