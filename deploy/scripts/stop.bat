@echo off
chcp 65001 >nul 2>&1

:: ================================================================
::  DriverRisk Platform - Stop
::  Gracefully stops nginx, then force-kills listeners on 8080/8000.
::  Use PowerShell path filter to avoid killing unrelated java/python.
::
::  Self-elevates first: services are launched ELEVATED (admin install +
::  auto-start task RunLevel=HighestAvailable), so a normal-user taskkill /
::  Stop-Process is denied ("Access is denied", silently) and the services
::  keep running. Admin rights are required to terminate them.
:: ================================================================

:: ---- Self-elevate: relaunch as administrator if not already elevated ----
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
    exit /b
)

setlocal enabledelayedexpansion

set "APPDIR=%~dp0"
if "!APPDIR:~-1!"=="\" set "APPDIR=!APPDIR:~0,-1!"
cd /d "!APPDIR!"

echo.
echo  Stopping DriverRisk Platform...
echo.

:: ---- 1. Nginx (graceful quit, then forceful cleanup) ----
echo  [1/3] Nginx...
if exist "!APPDIR!\nginx\nginx.exe" (
    pushd "!APPDIR!\nginx"
    "!APPDIR!\nginx\nginx.exe" -s quit >nul 2>&1
    popd
    timeout /t 2 /nobreak >nul
)
:: Fallback: kill any remaining nginx.exe under our install path
powershell -ExecutionPolicy Bypass -Command ^
  "Get-CimInstance Win32_Process -Filter \"Name='nginx.exe'\" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('!APPDIR!') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
:: Port-based fallback (mirrors start.bat): kill any remaining :3000 listener
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do taskkill /PID %%a /T /F >nul 2>&1

:: ---- 2. Backend (port 8080) ----
echo  [2/3] Backend...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8080 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /T /F >nul 2>&1
)

:: ---- 3. AI Engine (port 8000) ----
echo  [3/3] AI Engine...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /T /F >nul 2>&1
)

:: Final defensive sweep: kill java/python processes running from our install dir
powershell -ExecutionPolicy Bypass -Command ^
  "Get-CimInstance Win32_Process -Filter \"Name='java.exe' OR Name='python.exe' OR Name='pythonw.exe'\" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('!APPDIR!') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo.
echo  ========================================
echo    DriverRisk Platform stopped.
echo  ========================================
echo.
timeout /t 3 /nobreak >nul
endlocal
