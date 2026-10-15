#!/usr/bin/env bash
# 内网穿透保活脚本：手机 4G 可访问
# 用法:
#   bash scripts/tunnel.sh status   查看当前状态与访问地址
#   bash scripts/tunnel.sh ensure   确保本地服务+隧道可用，失效自动重建
#   bash scripts/tunnel.sh loop     常驻保活（每分钟自检，断线自动重建）

PORT=8080
PROXY=127.0.0.1:18080
URL_FILE=/tmp/pinggy-url
SSH_LOG=/tmp/pinggy.log

c() { curl -sf -o /dev/null --max-time "${2:-8}" "$1"; }

ensure_server() {
  if c "http://localhost:$PORT/" 3 && pgrep -f "scripts/server.py" >/dev/null; then
    echo "[check] 本地服务 OK  (http://localhost:$PORT)"
    return 0
  fi
  echo "[check] 本地服务需更新或未启动，正在重启（带 no-store 缓存头）..."
  pkill -f "http.server $PORT" 2>/dev/null
  pkill -f "scripts/server.py" 2>/dev/null
  sleep 1
  nohup python3 /workspace/scripts/server.py >/tmp/http.log 2>&1 &
  sleep 1
  if c "http://localhost:$PORT/" 3; then
    echo "[check] 本地服务 OK  (http://localhost:$PORT)"
    return 0
  fi
  echo "[check] 本地服务启动失败，查看 /tmp/http.log"
  return 1
}

cur_url() { [ -f "$URL_FILE" ] && tr -d '[:space:]' < "$URL_FILE"; }

tunnel_ok() {
  local u; u=$(cur_url)
  [ -n "$u" ] && c "$u/" 12
}

start_tunnel() {
  pkill -f "ssh.*a\.pinggy\.io" 2>/dev/null
  sleep 1
  : > "$SSH_LOG"
  nohup ssh -p 443 \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
    -o "ProxyCommand=nc -X connect -x $PROXY %h %p" \
    -R0:localhost:$PORT free@a.pinggy.io >"$SSH_LOG" 2>&1 &
  for _ in $(seq 1 20); do
    sleep 1
    local u
    u=$(grep -oE 'https://[a-z0-9-]+\.free\.pinggy\.net' "$SSH_LOG" | head -1)
    if [ -n "$u" ]; then
      echo "$u" > "$URL_FILE"
      echo "[tunnel] 隧道已重建: $u"
      return 0
    fi
  done
  echo "[tunnel] 建立失败，日志尾部："
  tail -3 "$SSH_LOG"
  return 1
}

cmd_status() {
  ensure_server
  local u; u=$(cur_url)
  if tunnel_ok; then
    echo "[tunnel] 隧道 OK   ($u)"
  else
    echo "[tunnel] 隧道失效  ($u)"
  fi
  echo "访问地址: $(tunnel_ok && echo "$u" || echo '暂不可用，运行 ensure 重建')"
}

cmd_ensure() {
  ensure_server || return 1
  if tunnel_ok; then
    echo "[tunnel] 隧道 OK   ($(cur_url))"
  else
    echo "[tunnel] 隧道失效，正在重建..."
    start_tunnel || return 1
  fi
  local u; u=$(cur_url)
  if c "$u/" 12; then
    echo "[check] 公网可达 OK ($u)"
    echo "==> 手机/电脑访问: $u"
  else
    echo "[check] 公网仍不可达"
    return 1
  fi
}

cmd_loop() {
  cmd_ensure || true
  while true; do
    sleep 60
    ensure_server || true
    if ! tunnel_ok; then
      echo "[tunnel] $(date '+%H:%M:%S') 检测到隧道失效，自动重建..."
      start_tunnel || true
    fi
  done
}

case "${1:-status}" in
  status) cmd_status ;;
  ensure) cmd_ensure ;;
  loop)   cmd_loop ;;
  *) echo "用法: bash scripts/tunnel.sh {status|ensure|loop}"; exit 1 ;;
esac
