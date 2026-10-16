#!/usr/bin/env bash
# Firebase CLI 관리자 로그인으로 침례 값을 변경한다. 기존 명령 사용법 유지.
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$script_dir/set-baptism.mjs" "$@"
