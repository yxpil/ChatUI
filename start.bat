@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set PORT=5173

echo ============================================================
echo   ChatUI  本地服务启动器
echo ------------------------------------------------------------
echo   访问地址 : http://localhost:%PORT%/
echo   停止服务 : 直接关闭本窗口
echo ============================================================
echo.

rem 样式产物缺失时，尝试用 Tailwind 现场编译（需要 Node.js）
if not exist "assets\css\app.css" (
  echo [信息] 未找到样式产物，尝试 npm run build 编译 Tailwind...
  where npm >nul 2>nul && call npm run build || echo [提示] 编译失败，界面样式可能不完整。
  echo.
)

start "" cmd /c "timeout /t 2 >nul & start "" http://localhost:%PORT%/"

where python >nul 2>nul
if %errorlevel%==0 (
  echo [信息] 使用 Python 启动静态服务器...
  python -m http.server %PORT%
  goto :end
)

where py >nul 2>nul
if %errorlevel%==0 (
  echo [信息] 使用 py 启动静态服务器...
  py -m http.server %PORT%
  goto :end
)

where node >nul 2>nul
if %errorlevel%==0 (
  echo [信息] 使用 Node.js 启动静态服务器...
  npx --yes http-server -p %PORT% -c-1
  goto :end
)

echo [错误] 未检测到 Python 或 Node.js。
echo.
echo 你可以直接双击 index.html 使用（无需任何服务器）。
echo 只是访问本地模型（Ollama / LM Studio）时，浏览器对 file:// 的跨域限制更严格，
echo 建议安装 Python 后重新运行本脚本，或按下述方式放行跨域。
echo.
pause

:end
endlocal
