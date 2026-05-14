#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUARTZ_DIR="$SCRIPT_DIR/.quartz"
QUARTZ_REPO="git@github.com:jackyzha0/quartz.git"
PORT=8080

# 首次运行：克隆 Quartz 并安装依赖
if [ ! -d "$QUARTZ_DIR" ]; then
  echo ">>> 首次运行，克隆 Quartz..."
  git clone --depth 1 "$QUARTZ_REPO" "$QUARTZ_DIR"
  echo ">>> 克隆完成"
  echo ">>> 安装依赖（pnpm）..."
  pnpm install --dir "$QUARTZ_DIR"
  pnpm approve-builds --dir "$QUARTZ_DIR" --all
  echo ">>> 依赖安装完成"
else
  echo ">>> Quartz 已存在，跳过克隆"
fi

# 同步配置文件
echo ">>> 同步配置文件..."
cp "$SCRIPT_DIR/.quartz-config/quartz.config.ts" "$QUARTZ_DIR/quartz.config.ts"
echo "    quartz.config.ts -> $QUARTZ_DIR/quartz.config.ts"
cp "$SCRIPT_DIR/.quartz-config/quartz.layout.ts" "$QUARTZ_DIR/quartz.layout.ts"
echo "    quartz.layout.ts -> $QUARTZ_DIR/quartz.layout.ts"
cp "$SCRIPT_DIR/.quartz-config/custom.scss" "$QUARTZ_DIR/quartz/styles/custom.scss"
echo "    custom.scss      -> $QUARTZ_DIR/quartz/styles/custom.scss"

# 构建静态文件（不启动 watcher，彻底避免 EMFILE）
echo ">>> 静态文件构建中..."
cd "$QUARTZ_DIR"
export QUARTZ_LOCAL=1
npx quartz build --directory "$SCRIPT_DIR"

# 用 http-server 提供静态预览，--ext html 处理 clean URL
echo ">>> 预览地址：http://localhost:$PORT"
echo ">>> 修改文件后重新运行 ./preview.sh 即可刷新"
npx --yes http-server "$QUARTZ_DIR/public" -p $PORT --ext html -c-1 -o
