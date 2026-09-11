@echo off
REM ============================================================
REM  Run Aqua - double-click this file to start her up.
REM  (Run setup.bat first, one time only.)
REM ============================================================
setlocal
cd /d "%~dp0"
chcp 65001 >nul

if not exist ".venv\Scripts\python.exe" (
    echo.
    echo Aqua isn't set up yet. Please double-click "setup.bat" first.
    echo.
    pause
    exit /b 1
)

".venv\Scripts\python.exe" aqua.py %*

echo.
echo Aqua has closed her ears for now. See you next time!
pause
