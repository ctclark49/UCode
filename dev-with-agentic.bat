@echo off
REM Start Next.js Development with Agentic Orchestrator
REM This runs the complete production-like setup locally

echo ================================================
echo   Starting EzCoder Development Environment
echo   with Agentic AI Orchestrator
echo ================================================
echo.

REM Check if Redis port-forward is running
echo [1/4] Checking Redis connection...
netstat -ano | findstr ":6379" > nul
if %errorlevel% equ 0 (
    echo   ✓ Redis port-forward is running on port 6379
) else (
    echo   ⚠ Redis port-forward not detected
    echo   Starting Redis port-forward from GKE...
    start "Redis Port Forward" cmd /k "C:\Users\ctcla\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\kubectl.exe" port-forward svc/redis 6379:6379 -n newk8v2-production
    timeout /t 3 /nobreak > nul
    echo   ✓ Redis port-forward started
)
echo.

REM Set environment variables for agentic orchestrator
echo [2/4] Configuring environment...
REM Get API key from environment or .env file
if not defined ANTHROPIC_API_KEY (
    echo ⚠ ANTHROPIC_API_KEY not set! Please set it in your environment.
    echo Example: set ANTHROPIC_API_KEY=your-key-here
    exit /b 1
)
set REDIS_HOST=localhost
set REDIS_PORT=6379
set AGENT_TYPE=generic
set NODE_ENV=development
echo   ✓ Environment configured
echo.

REM Start agentic orchestrator in background
echo [3/4] Starting Agentic Orchestrator...
start "Agentic Orchestrator" cmd /k "set ANTHROPIC_API_KEY=%ANTHROPIC_API_KEY% && set REDIS_HOST=%REDIS_HOST% && set REDIS_PORT=%REDIS_PORT% && set AGENT_TYPE=%AGENT_TYPE% && node server/agentic-orchestrator-streaming.js"
timeout /t 2 /nobreak > nul
echo   ✓ Agentic Orchestrator started on port 8082
echo.

REM Start Next.js dev server
echo [4/4] Starting Next.js development server...
echo   ✓ Next.js will start on http://localhost:3000
echo.
echo ================================================
echo   Development Environment Ready!
echo ================================================
echo.
echo   Next.js:              http://localhost:3000
echo   Agentic Health:       http://localhost:8082/health
echo   Redis (port-forward): localhost:6379
echo.
echo   The agentic AI system is running locally with:
echo   - Real-time streaming (SSE)
echo   - Claude 3.5 Sonnet tool-calling
echo   - Same behavior as GKE production
echo.
echo   Press Ctrl+C to stop Next.js
echo   (Other services will keep running in separate windows)
echo ================================================
echo.

npm run dev
