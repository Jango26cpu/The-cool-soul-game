@echo off
cd /d "%~dp0"
start "The Cool Soul Game Server" cmd.exe /k call "%~dp0start_windows_core.bat"
exit /b 0
