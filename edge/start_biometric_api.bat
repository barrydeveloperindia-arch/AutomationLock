@echo off
SETLOCAL EnableDelayedExpansion

echo 🔍 Checking for Python installation...

:: Try common Windows User path (Python 3.13)
if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" (
    set PY_CMD="%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
    goto FOUND
)

:: Try common Windows User path (Python 3.10)
if exist "%LOCALAPPDATA%\Programs\Python\Python310\python.exe" (
    set PY_CMD="%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
    goto FOUND
)

:: Try common Windows User path (Python 3.9)
if exist "%LOCALAPPDATA%\Programs\Python\Python39\python.exe" (
    set PY_CMD="%LOCALAPPDATA%\Programs\Python\Python39\python.exe"
    goto FOUND
)

:: Try py launcher
where py >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set PY_CMD=py
    goto FOUND
)

:: Try standard python
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set PY_CMD=python
    goto FOUND
)

:: Try AppData Local path
if exist "%USERPROFILE%\AppData\Local\Microsoft\WindowsApps\python.exe" (
    set PY_CMD="%USERPROFILE%\AppData\Local\Microsoft\WindowsApps\python.exe"
    goto FOUND
)

echo ❌ Python not found in standard paths.
echo Please ensure Python is installed and added to your PATH environment variable.
echo Or edit this file to include your specific python.exe path.
pause
exit /b

:FOUND
echo ✅ Using Python command: !PY_CMD!

:: --- Kill any stale Python processes on port 8001 to prevent WinError 10048 ---
echo 🔄 Clearing port 8001 of any stale processes...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8001"') do (
    taskkill /F /PID %%a >nul 2>&1
)
echo ✅ Port 8001 is clear. Starting Biometric API...

!PY_CMD! biometric_api.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ❌ Server crashed or failed to start.
    echo Ensuring dependencies are installed...
    !PY_CMD! -m pip install fastapi uvicorn face_recognition pillow numpy supabase
    echo.
    echo 🔄 Retrying...
    !PY_CMD! biometric_api.py
)

pause
