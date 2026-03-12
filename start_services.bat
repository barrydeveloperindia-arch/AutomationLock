@echo off
:: AuraLock Service Manager
:: Run as Administrator for best results
:: ──────────────────────────────────────────────────────────────────
:: Usage:
::   start_services.bat          → start all services
::   start_services.bat status   → show service status
::   start_services.bat restart  → restart all services
::   start_services.bat logs     → tail recent logs
::   start_services.bat stop     → stop all services
:: ──────────────────────────────────────────────────────────────────

SET PM2=cmd /c pm2

IF "%1"=="status"  GOTO STATUS
IF "%1"=="restart" GOTO RESTART
IF "%1"=="logs"    GOTO LOGS
IF "%1"=="stop"    GOTO STOP

:START
echo [AuraLock] Starting all services via PM2...
%PM2% start "%~dp0ecosystem.config.js" 2>nul
IF %ERRORLEVEL% NEQ 0 (
    echo [AuraLock] Services already running. Checking status...
)
GOTO STATUS

:STATUS
echo.
%PM2% status
echo.
echo [Ports]
netstat -ano | findstr ":8000 :8001 " | findstr "LISTENING"
echo.
GOTO END

:RESTART
echo [AuraLock] Restarting all services...
%PM2% restart all
GOTO STATUS

:STOP
echo [AuraLock] Stopping all services...
%PM2% stop all
GOTO END

:LOGS
%PM2% logs --lines 50
GOTO END

:END
pause
