@echo off
setlocal
pushd "%~dp0llama_cuda"
if errorlevel 1 exit /b 1

"%~dp0llama_cuda\llama-server.exe" -m "%~dp0models\Ternary-Bonsai-2-27B-PQ2_0.gguf" --host 127.0.0.1 --port 8080 --jinja --mcp-servers-config "%~dp0mcps\mcp-servers.json"
set "server_exit_code=%errorlevel%"

popd
if not "%server_exit_code%"=="0" (
    echo.
    echo llama-server exited with code %server_exit_code%.
    pause
)

exit /b %server_exit_code%
