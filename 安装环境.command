#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
bash install.sh
printf '\n安装程序已退出。按回车关闭窗口。\n'
read -r _
