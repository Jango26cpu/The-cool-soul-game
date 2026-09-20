@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title The Cool Soul Game - Diagnostics

echo ===== The Cool Soul Game Windows Diagnostics =====
echo Folder: %CD%
echo.
echo [1] Files
if exist "server.js" (echo server.js: OK) else (echo server.js: MISSING)
if exist "public\index.html" (echo public\index.html: OK) else (echo public\index.html: MISSING)
echo.
echo [2] Node.js PATH
where node.exe 2>&1
echo.
echo [3] Common Node.js location
if exist "%ProgramFiles%\nodejs\node.exe" (
  "%ProgramFiles%\nodejs\node.exe" --version
) else (
  echo Not found in Program Files.
)
echo.
echo [4] Port 3000
netstat -ano | findstr ":3000"
if errorlevel 1 echo Port 3000 does not appear to be in use.
echo.
echo Send a screenshot of this window if startup still fails.
pause
endlocal
