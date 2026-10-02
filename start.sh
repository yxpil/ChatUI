#!/usr/bin/env bash
# ChatUI 本地静态服务启动器
set -e
cd "$(dirname "$0")"
PORT="${PORT:-5173}"

echo "============================================================"
echo "  ChatUI 本地服务"
echo "  访问地址 : http://localhost:${PORT}/"
echo "  停止服务 : Ctrl + C"
echo "============================================================"

# 样式产物缺失时，尝试用 Tailwind 现场编译（需要 Node.js）
if [ ! -f "assets/css/app.css" ] && command -v npm >/dev/null 2>&1; then
  echo "[信息] 未找到样式产物，执行 npm run build 编译 Tailwind..."
  npm run build || echo "[提示] 编译失败，界面样式可能不完整。"
  echo ""
fi

(
  sleep 1
  if command -v open >/dev/null 2>&1; then open "http://localhost:${PORT}/"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:${PORT}/"
  fi
) &

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  exec python -m http.server "$PORT"
else
  exec npx --yes http-server -p "$PORT" -c-1
fi
