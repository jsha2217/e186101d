# 공용 비밀번호 인증 및 데이터베이스 운영

## 접근 정책

- 화면과 사용법은 이름 자유 입력 + 기존 공용 비밀번호를 유지한다. 다른 팀원 이름으로 입장해도 허용한다.
- Firebase Authentication의 내부 공용 계정은 UID `connector-team`, 이메일 `connector-team@paw-hello-sy.invalid`이다. 이 값들은 공개 식별자이며 비밀번호가 아니다.
- 로그인은 Firebase 서버가 비밀번호를 확인한다. 브라우저에 비밀번호/비밀번호 해시를 넣지 않는다.
- 다른 Firebase 계정이나 익명 로그인은 DB 접근 자격이 없다. 루트 읽기/쓰기도 차단한다.
- 지정 공용 계정은 `contacts`, `appointments`, `validations`, `validationSummaries`, `guideContacts`를 기존처럼 함께 조회/수정/삭제한다.
- `meta/paginationVersion`은 팀 계정이 읽기만 한다. `_security`, 미지정 경로는 관리자로만 접근한다.
- `_security/minAuthTime`은 허용하는 최소 로그인 시각(초)이다. 비밀번호 변경 시 갱신하면 기존 토큰도 DB 규칙에서 즉시 거부한다. 토큰 새로고침은 최초 로그인 시각을 바꾸지 않는다.
- Firebase 인증 설정에서 일반 사용자 가입과 계정 삭제를 비활성화한다. 관리자 API는 계속 계정을 관리할 수 있다.
- Firebase Authentication의 자체 로그인 시도 제한을 사용한다. 별도 인증 서버/Cloud Functions/Blaze 플랜을 추가하지 않는다.

## 일반 배포와 검증

```sh
npm ci
npm test
npm run test:rules
firebase login
firebase deploy --only database --project paw-hello-sy
```

웹은 GitHub Pages의 `master` 브랜치 루트에서 서비스한다. 인증 방식이나 규칙이 함께 바뀌는 경우 **인증 설정과 계정 준비 → 웹 배포 확인 → DB 규칙 잠금 → 운영 접근 검증** 순서를 지킨다. 예전 페이지를 열어 둔 사람은 새로고침 후 최초 한 번 기존 비밀번호를 다시 입력한다.

`npm test`는 기존 동작과 인증/자동 로그인/만료/로그아웃 경쟁 상태를 검증한다. `npm run test:rules`는 `demo-connector` 로컬 DB 에뮬레이터에서 무인증/다른 계정/만료된 세션 거부, 팀 공유/페이지 조회/달력/다중 경로 저장/일괄 삭제를 검증한다. 거부 테스트의 `permission_denied` 경고는 예상된 결과다.

운영 검증은 개인정보 없는 `meta/paginationVersion`으로 무인증 조회 거부를 확인한다. 쓰기 차단 검증에는 고유한 일회성 시험 경로만 사용하며 기존 자료를 덮어쓰거나 삭제하지 않는다.

## 기존 비밀번호 이전

2026-10-16 이전 JS의 SHA-256 비밀번호 검증값을 Firebase Auth 사용자 가져오기의 `SHA256`, `rounds=1` 형식으로 이전한다. 비밀번호 원문을 알거나 변경할 필요가 없다. 같은 방식으로 만든 일회성 검증 계정으로 실제 Firebase 로그인 성공을 확인하고 검증 계정은 제거한다. 이후에는 가져오기 작업을 반복하지 않는다.

공개 Git 기록에는 옛 비밀번호 해시가 남아 있다. 이번 배포는 원문 비밀번호를 유지하는 요구를 따른다. 추후 비밀번호 변경을 원하면 아래 관리자 절차를 사용한다.

## 공용 비밀번호 변경

```sh
firebase login
node scripts/set-team-password.cjs
```

관리자 터미널에서 새 비밀번호와 확인값을 입력한다. 입력은 화면에 표시되지 않으며 코드/명령 인자/파일에 저장하지 않는다. Firebase의 비밀번호를 변경하고 DB의 최소 인증 시각을 올려 다른 기기를 포함한 기존 세션의 접근도 해제한다. 팀원은 1초 후 새 비밀번호로 다시 로그인한다. 웹 재배포는 필요하지 않다. 새 비밀번호 공유는 관리자가 직접 한다.

## 침례 표시와 인덱스 관리

```sh
firebase login
scripts/set-baptism.sh                 # 없는 baptism 필드만 0으로 백필
scripts/set-baptism.sh <contactId> 1    # 기존 명령 사용법 유지
node scripts/migrate-pagination.mjs   # 읽기 전용 점검
node scripts/migrate-pagination.mjs --apply
```

관리 스크립트는 Firebase CLI 관리자 세션으로 접근한다. 공개 REST 접근, 브라우저 공용 비밀번호, 수동 복사한 인증 토큰을 사용하지 않는다. `scripts/firebase-admin-api.cjs`는 비밀번호 관리용으로 설치된 Firebase CLI의 로그인 세션을 재사용하며, 토큰을 터미널에 출력하거나 별도 파일에 저장하지 않는다.

## 백업과 복구

배포 전 데이터 백업은 `backups/before-auth-20261016.json`, 운영 규칙 백업은 `backups/rules-before-auth-20261016.json`에 로컬로 저장한다. 이 폴더와 `.security-private/`는 Git에서 제외한다. 백업은 개인정보를 포함하므로 공개 저장소/웹에 올리지 않는다.

새 규칙은 기존 데이터를 변환하지 않는다. 장애 시 관리자 인증으로 조회하고, 인증 설정/공용 계정/최소 인증 시각/웹 배포 버전을 확인한다. 업무 기능 복구를 위해 공개 `.read: true`, `.write: true` 규칙으로 되돌리지 않는다. 잘못된 최소 인증 시각은 관리자만 조정한다.

Firebase의 경고 메일은 운영 규칙 변경 후 감지 주기에 따라 반영된다. 코드 커밋이나 웹 배포만으로 DB 규칙이 바뀌지는 않는다.
