@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title The Cool Soul Game Online Beta 1.0.1

echo ============================================================
echo   The Cool Soul Game Online Beta 1.0.1 - Windows Launcher
echo ============================================================
echo.
echo Working folder:
echo   %CD%
echo.

if not exist "server.js" (
  echo [ERROR] server.js was not found.
  echo.
  echo Please extract the ZIP first, then run start_windows.bat
  echo from inside the extracted game folder.
  goto :hold
)

set "NODE_EXE="
for /f "delims=" %%I in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"

if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE_EXE (
  echo [ERROR] Node.js was not found.
  echo.
  echo Install Node.js 18 or newer, then run this file again.
  echo After installation, restarting Windows is sometimes helpful.
  goto :hold
)

echo Node.js found:
echo   %NODE_EXE%
echo.
"%NODE_EXE%" --version
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js exists but could not be executed.
  goto :hold
)

echo.
echo Checking server.js...
"%NODE_EXE%" --check "server.js"
if errorlevel 1 (
  echo.
  echo [ERROR] server.js failed the syntax check.
  goto :hold
)

echo [OK] Syntax check passed.
echo.
echo Starting server...
echo Keep this window OPEN while playing.
echo When startup succeeds, open: http://localhost:3000
echo.
echo ------------------------------------------------------------
"%NODE_EXE%" "server.js"
set "SERVER_EXIT=%ERRORLEVEL%"
echo ------------------------------------------------------------
echo.
echo [STOPPED] The server process ended with exit code %SERVER_EXIT%.
echo If an error is shown above, take a screenshot and send it to ChatGPT.

goto :hold

:hold
echo.
echo This window will stay open so the error can be read.
echo You may close it manually when finished.
echo.
pause
endlocal
