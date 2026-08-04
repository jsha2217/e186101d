#!/usr/bin/env bash
# 연결자(contacts)의 baptism 필드(0 또는 1)를 직접 조작하는 터미널 스크립트.
# 앱 UI에는 이 필드에 대한 입력 폼이 없음 — 값 변경은 항상 이 스크립트를 통해서만 이뤄짐.
set -euo pipefail

DB_URL="https://paw-hello-sy-default-rtdb.europe-west1.firebasedatabase.app"

usage(){
  echo "사용법:" >&2
  echo "  $0                     # 백필: baptism 필드가 없는 기존 연결자 전부에 0을 채워넣음" >&2
  echo "  $0 <contactId> <0|1>   # 특정 연결자의 baptism 값을 설정" >&2
  exit 1
}

if [[ $# -eq 0 ]]; then
  ids=$(curl -sf "$DB_URL/contacts.json?shallow=true" | node -e "
    const d = JSON.parse(require('fs').readFileSync(0,'utf8')) || {};
    process.stdout.write(Object.keys(d).join('\n'));
  ")
  if [[ -z "$ids" ]]; then
    echo "연결자가 없습니다."
    exit 0
  fi
  count=0
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    current=$(curl -sf "$DB_URL/contacts/$id/baptism.json")
    if [[ "$current" == "null" ]]; then
      curl -sf -X PATCH -d '{"baptism":0}' "$DB_URL/contacts/$id.json" > /dev/null
      echo "backfilled: $id -> baptism=0"
      count=$((count+1))
    fi
  done <<< "$ids"
  echo "완료: ${count}건 백필"
  exit 0
fi

if [[ $# -ne 2 ]]; then
  usage
fi

id="$1"
value="$2"

if [[ "$value" != "0" && "$value" != "1" ]]; then
  echo "오류: 값은 0 또는 1만 가능합니다 (입력값: $value)" >&2
  exit 1
fi

exists=$(curl -sf "$DB_URL/contacts/$id/name.json")
if [[ "$exists" == "null" ]]; then
  echo "오류: contacts/$id 를 찾을 수 없습니다" >&2
  exit 1
fi

curl -sf -X PATCH -d "{\"baptism\":$value}" "$DB_URL/contacts/$id.json" > /dev/null
echo "완료: contacts/$id baptism -> $value"
