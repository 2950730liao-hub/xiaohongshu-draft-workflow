#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"
command -v unzip >/dev/null 2>&1 || { echo '缺少 unzip，请先通过系统包管理器安装后重试。' >&2; exit 1; }

case "$(uname -s)" in
  Darwin) NODE_PLATFORM=darwin ;;
  Linux) NODE_PLATFORM=linux ;;
  *) echo '自动安装支持 macOS / Linux。Windows 请使用支持图形浏览器的 Linux 环境。' >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) NODE_ARCH=arm64 ;;
  x86_64|amd64) NODE_ARCH=x64 ;;
  *) echo '当前处理器架构尚未支持自动安装。' >&2; exit 1 ;;
esac

if [[ -x "$PROJECT_ROOT/.runtime/node/bin/node" ]]; then
  export PATH="$PROJECT_ROOT/.runtime/node/bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' 2>/dev/null || ! command -v npm >/dev/null 2>&1; then
  for dependency in curl tar awk; do
    command -v "$dependency" >/dev/null 2>&1 || { echo "缺少基础工具 $dependency" >&2; exit 1; }
  done
  mkdir -p .runtime
  NODE_STAGE="$(mktemp -d "$PROJECT_ROOT/.runtime/node-download.XXXXXX")"
  trap 'rm -rf "$NODE_STAGE"' EXIT
  curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 2 \
    https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$NODE_STAGE/SHASUMS256.txt"
  NODE_ASSET="$(awk -v suffix="-$NODE_PLATFORM-$NODE_ARCH.tar.gz" '$2 ~ /^node-v24\./ && substr($2,length($2)-length(suffix)+1)==suffix {print $2; exit}' "$NODE_STAGE/SHASUMS256.txt")"
  [[ -n "$NODE_ASSET" ]] || { echo '未找到对应架构的 Node 24 官方安装包。' >&2; exit 1; }
  NODE_VERSION="${NODE_ASSET#node-}"
  NODE_VERSION="${NODE_VERSION%-$NODE_PLATFORM-$NODE_ARCH.tar.gz}"
  curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 2 \
    "https://nodejs.org/dist/$NODE_VERSION/$NODE_ASSET" -o "$NODE_STAGE/$NODE_ASSET"
  NODE_EXPECTED="$(awk -v asset="$NODE_ASSET" '$2==asset {print $1}' "$NODE_STAGE/SHASUMS256.txt")"
  if command -v shasum >/dev/null 2>&1; then
    NODE_ACTUAL="$(shasum -a 256 "$NODE_STAGE/$NODE_ASSET" | awk '{print $1}')"
  else
    NODE_ACTUAL="$(sha256sum "$NODE_STAGE/$NODE_ASSET" | awk '{print $1}')"
  fi
  [[ "$NODE_EXPECTED" == "$NODE_ACTUAL" ]] || { echo 'Node 安装包 SHA256 校验失败。' >&2; exit 1; }
  mkdir "$NODE_STAGE/unpacked"
  tar -xzf "$NODE_STAGE/$NODE_ASSET" -C "$NODE_STAGE/unpacked" --strip-components=1
  if [[ -e .runtime/node ]]; then
    echo '已有不可用的 .runtime/node，请移到其他位置后重试。' >&2
    exit 1
  fi
  mv "$NODE_STAGE/unpacked" .runtime/node
  rm -rf "$NODE_STAGE"
  trap - EXIT
  export PATH="$PROJECT_ROOT/.runtime/node/bin:$PATH"
fi
command -v npm >/dev/null 2>&1 || { echo '当前 Node 缺少 npm，请安装包含 npm 的 Node 24 发行版。' >&2; exit 1; }
exec node scripts/install.mjs "$@"
