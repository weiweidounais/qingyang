#!/bin/zsh
set -eu
cd "$(dirname "$0")/../../.."
python3 src/features/nutrition/dev/local.py start
