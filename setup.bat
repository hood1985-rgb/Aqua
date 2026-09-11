@echo off
REM ============================================================
REM  Aqua setup - run this ONCE (or after changing requirements)
REM  It creates a private Python environment and installs
REM  everything Aqua needs. Just double-click this file.
REM ============================================================
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo.
echo === Aqua setup ===
echo.

REM Find a Python to use (the "py" launcher is best)
where py >nul 2>nul
if %errorlevel%==0 (
    set "PYCMD=py -3"
) else (
    set "PYCMD=python"
)

echo Creating a private Python environment (.venv)...
%PYCMD% -m venv .venv
if errorlevel 1 (
    echo.
    echo [!] Couldn't create the environment. Make sure Python 3.10 or newer
    echo     is installed from https://www.python.org/downloads/ and that you
    echo     checked "Add python.exe to PATH" during installation.
    echo.
    pause
    exit /b 1
)

echo Installing Aqua's dependencies (this can take a few minutes)...
".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo [!] Setup failed. Check the messages above.
    echo     If your PC blocks installs, right-click this file and "Run as administrator".
    echo.
    pause
    exit /b 1
)

echo.
echo === Setup complete! ===
echo.
echo   Double-click "Run Aqua.bat" whenever you want to talk to her.
echo.
echo   First time tips:
echo     - Press Enter on an empty line to speak with your voice
echo     - Or just type normally
echo     - Type /help to see everything she can do
echo.
pause
