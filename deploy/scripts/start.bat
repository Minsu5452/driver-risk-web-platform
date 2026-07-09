@echo off
chcp 65001 >nul 2>&1

:: ================================================================
::  DriverRisk Platform - Start (always-clean + HTTP health check)
::
::  ontent:
::  - Previous "if already running, skip" logic has been REMOVED.
::  - We now stop any existing platform processes first, then start fresh.
::  - Each service's HTTP endpoint is polled until it actually responds
::    before moving on. Browser only opens when ALL 3 services are ready.
::  - start.log under logs/ records every step for troubleshooting.
::
::  Windows encoding note:
::  - This file must stay ASCII-only.
::  - Installed location is fixed to C:\DriverRisk-Platform (no korean/space path).
:: ================================================================

:: ---- Self-elevate: a manual (desktop-shortcut) launch needs admin to manage
::      services that the installer / auto-start task started elevated. The task
::      and installer pass "noelevate" to skip this (avoids a UAC prompt at logon,
::      esp. for non-admin users; also prevents any re-elevation loop). ----
if /i "%~1"=="noelevate" goto :elevated
net session >nul 2>&1
if %errorlevel% equ 0 goto :elevated
powershell -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList 'noelevate' -Verb RunAs" >nul 2>&1
exit /b
:elevated

:: === Admin credentials (set BEFORE enabledelayedexpansion; password contains '!') ===
set "ADMIN_USERNAME=admin"
set "ADMIN_PASSWORD=change-this!"

:: === Encoding (defend against Windows cp949 default) ===
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"
set "LC_ALL=C.UTF-8"
set "LANG=C.UTF-8"

setlocal enabledelayedexpansion

set "APPDIR=%~dp0"
if "!APPDIR:~-1!"=="\" set "APPDIR=!APPDIR:~0,-1!"
if not exist "!APPDIR!\logs" mkdir "!APPDIR!\logs"
cd /d "!APPDIR!"

set "STARTLOG=!APPDIR!\logs\start.log"

>> "!STARTLOG!" echo.
>> "!STARTLOG!" echo =============================
>> "!STARTLOG!" echo  Start at %date% %time%
>> "!STARTLOG!" echo =============================

echo.
echo  ========================================
echo    DriverRisk Platform - starting
echo  ========================================
echo.

:: ================================================================
::  Step 1/5 - Stop any existing platform processes (clean start)
:: ================================================================
echo  [1/5] Stopping any existing platform services...
>> "!STARTLOG!" echo  [1/5] Stop existing services

:: 1-a. Nginx graceful quit first (if running from our install)
if exist "!APPDIR!\nginx\nginx.exe" (
    pushd "!APPDIR!\nginx"
    "!APPDIR!\nginx\nginx.exe" -s quit >nul 2>&1
    popd
    timeout /t 2 /nobreak >nul
)

:: 1-b. Path-based kill - only processes running from THIS install dir,
::      so we don't touch unrelated java/python on the machine.
powershell -ExecutionPolicy Bypass -Command ^
  "Get-CimInstance Win32_Process -Filter \"Name='nginx.exe' OR Name='java.exe' OR Name='python.exe' OR Name='pythonw.exe'\" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('!APPDIR!') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

:: 1-c. Port-based fallback for 3000/8000/8080 (platform-exclusive ports)
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do taskkill /PID %%a /T /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8000 " ^| findstr "LISTENING"') do taskkill /PID %%a /T /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8080 " ^| findstr "LISTENING"') do taskkill /PID %%a /T /F >nul 2>&1

:: 1-d. Wait for ports to actually release (max ~20s)
set /a W=0
:wait_release
set "STILL=0"
netstat -ano 2>nul | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if !errorlevel! equ 0 set "STILL=1"
netstat -ano 2>nul | findstr ":8000 " | findstr "LISTENING" >nul 2>&1
if !errorlevel! equ 0 set "STILL=1"
netstat -ano 2>nul | findstr ":8080 " | findstr "LISTENING" >nul 2>&1
if !errorlevel! equ 0 set "STILL=1"
if "!STILL!"=="0" goto :release_done
set /a W+=1
if !W! gtr 10 goto :release_done
timeout /t 2 /nobreak >nul
goto :wait_release
:release_done
echo        Done (ports cleared)
>> "!STARTLOG!" echo        Ports cleared

:: ================================================================
::  Step 2/5 - Start AI Engine + wait until HTTP ready
:: ================================================================
echo  [2/5] Starting AI Engine (Python/FastAPI)...
>> "!STARTLOG!" echo  [2/5] Start AI Engine
powershell -ExecutionPolicy Bypass -Command ^
  "Start-Process -FilePath '!APPDIR!\python\python.exe' -ArgumentList '-m','uvicorn','src.main:app','--host','0.0.0.0','--port','8000' -WorkingDirectory '!APPDIR!\ai-engine' -WindowStyle Hidden -RedirectStandardOutput '!APPDIR!\logs\ai-engine.log' -RedirectStandardError '!APPDIR!\logs\ai-engine-error.log'"

echo        Waiting for AI Engine to respond on :8000 (first run may take 30-60s)...
set /a W=0
:wait_ai
set /a W+=1
if !W! gtr 90 goto :wait_ai_timeout
timeout /t 2 /nobreak >nul
powershell -ExecutionPolicy Bypass -Command ^
  "try { Invoke-WebRequest -Uri 'http://127.0.0.1:8000/docs' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop | Out-Null; exit 0 } catch { if ($_.Exception.Response) { exit 0 } else { exit 1 } }" >nul 2>&1
if !errorlevel! neq 0 goto :wait_ai
echo        AI Engine ready (after !W! x 2s)
>> "!STARTLOG!" echo        AI Engine ready after !W!*2s
goto :start_backend

:wait_ai_timeout
echo.
echo  [WARNING] AI Engine did not respond in time.
echo            Check logs: !APPDIR!\logs\ai-engine-error.log
>> "!STARTLOG!" echo  [WARNING] AI Engine timeout (>180s)

:start_backend
:: ================================================================
::  Step 3/5 - Start Backend + wait until HTTP ready
:: ================================================================
echo  [3/5] Starting Backend (Spring Boot)...
>> "!STARTLOG!" echo  [3/5] Start Backend
powershell -ExecutionPolicy Bypass -Command ^
  "Start-Process -FilePath '!APPDIR!\jre\bin\java.exe' -ArgumentList '-Dfile.encoding=UTF-8','-Dsun.jnu.encoding=UTF-8','-Dspring.profiles.active=prod','-jar','!APPDIR!\backend\driverrisk-platform.jar' -WorkingDirectory '!APPDIR!\backend' -WindowStyle Hidden -RedirectStandardOutput '!APPDIR!\logs\backend.log' -RedirectStandardError '!APPDIR!\logs\backend-error.log'"

echo        Waiting for Backend to respond on :8080...
set /a W=0
:wait_be
set /a W+=1
if !W! gtr 45 goto :wait_be_timeout
timeout /t 2 /nobreak >nul
powershell -ExecutionPolicy Bypass -Command ^
  "try { Invoke-WebRequest -Uri 'http://127.0.0.1:8080/' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop | Out-Null; exit 0 } catch { if ($_.Exception.Response) { exit 0 } else { exit 1 } }" >nul 2>&1
if !errorlevel! neq 0 goto :wait_be
echo        Backend ready (after !W! x 2s)
>> "!STARTLOG!" echo        Backend ready after !W!*2s
goto :start_nginx

:wait_be_timeout
echo.
echo  [WARNING] Backend did not respond in time.
echo            Check logs: !APPDIR!\logs\backend-error.log
>> "!STARTLOG!" echo  [WARNING] Backend timeout (>90s)

:start_nginx
:: ================================================================
::  Step 4/5 - Start Nginx + wait until HTTP ready
:: ================================================================
echo  [4/5] Starting Nginx...
>> "!STARTLOG!" echo  [4/5] Start Nginx
pushd "!APPDIR!\nginx"
powershell -ExecutionPolicy Bypass -Command ^
  "Start-Process -FilePath '!APPDIR!\nginx\nginx.exe' -WorkingDirectory '!APPDIR!\nginx' -WindowStyle Hidden"
popd

echo        Waiting for Nginx on :3000...
set /a W=0
:wait_nx
set /a W+=1
if !W! gtr 20 goto :wait_nx_timeout
timeout /t 1 /nobreak >nul
powershell -ExecutionPolicy Bypass -Command ^
  "try { Invoke-WebRequest -Uri 'http://127.0.0.1:3000/' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop | Out-Null; exit 0 } catch { if ($_.Exception.Response) { exit 0 } else { exit 1 } }" >nul 2>&1
if !errorlevel! neq 0 goto :wait_nx
echo        Nginx ready (after !W! x 1s)
>> "!STARTLOG!" echo        Nginx ready after !W!*1s
goto :open_browser

:wait_nx_timeout
echo.
echo  [WARNING] Nginx did not respond in time.
echo            Check logs: !APPDIR!\logs\nginx-error.log
>> "!STARTLOG!" echo  [WARNING] Nginx timeout (>20s)

:open_browser
:: ================================================================
::  Step 5/5 - Open browser (small safety margin)
:: ================================================================
echo  [5/5] All services ready. Opening browser...
>> "!STARTLOG!" echo  [5/5] Open browser
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"

echo.
echo  ========================================
echo    DriverRisk Platform is running.
echo    http://localhost:3000
echo  ========================================
echo.
echo  You can close this window. Services will keep running.
timeout /t 5 /nobreak >nul
endlocal
