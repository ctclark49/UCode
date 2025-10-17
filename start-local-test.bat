@echo off
REM Start Local Testing Environment
REM Tests agentic orchestrator locally while GKE deployment runs in production

echo ====================================
echo Local Testing Environment
echo ====================================
echo.

echo This will start:
echo 1. Redis port-forward from GKE (localhost:6379)
echo 2. Local agentic orchestrator
echo 3. Instructions for testing
echo.

echo Checking if Redis port-forward is already running...
netstat -ano | findstr ":6379" > nul
if %errorlevel% equ 0 (
    echo ✓ Redis port-forward is already running on port 6379
) else (
    echo Starting Redis port-forward...
    start "Redis Port Forward" cmd /k "C:\Users\ctcla\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\kubectl.exe" port-forward svc/redis 6379:6379 -n newk8v2-production
    timeout /t 3 /nobreak > nul
    echo ✓ Redis port-forward started
)
echo.

echo Starting local agentic orchestrator...
echo.
echo Environment:
echo - REDIS_HOST: localhost
echo - REDIS_PORT: 6379
echo - AGENT_TYPE: generic
echo - ANTHROPIC_API_KEY: *** (configured)
echo.

REM Get API key from environment - DO NOT hardcode secrets!
if not defined ANTHROPIC_API_KEY (
    echo ⚠ ANTHROPIC_API_KEY not set! Please set it in your environment.
    echo Example: set ANTHROPIC_API_KEY=your-key-here
    exit /b 1
)
set REDIS_HOST=localhost
set REDIS_PORT=6379
set AGENT_TYPE=generic

echo ====================================
echo Starting Orchestrator...
echo ====================================
echo.
echo Press Ctrl+C to stop the orchestrator
echo.

node server/agentic-orchestrator-streaming.js
