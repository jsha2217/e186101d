# 프로젝트 로직 총정리 — 연결자 관리

빌드 시스템 없는 순수 정적 HTML/JS 앱. 백엔드는 Firebase Realtime Database.
파일 구성:
- `index.html` — 실제 서비스 (Firebase 연동, 공유 비밀번호 잠금). 미리보기/데모도 이 파일을 그대로 열어서 확인.
- `firebase.json`, `.firebaserc`, `database.rules.json` — Firebase RTDB 설정 (Hosting 설정은 없음, 아래 7번 참고)

## 1. 인증 (잠금 화면)

- 로그인은 "이름"(자유 텍스트, 사용자 식별자 역할) + "전체 공용 비밀번호" 2개 입력.
- 비밀번호를 SHA-256 해시하여 하드코딩된 `CORRECT_HASH`와 비교. 이름 자체는 검증하지 않고 단순히 `currentUser`로 저장되어 이후 모든 "내 연결자/약속" 필터링의 키로 사용됨 (즉 이름을 다르게 입력하면 다른 사람 행세 가능 — 진짜 인증이 아니라 "우리 팀만 아는 공용 비밀번호 + 자기 이름 자율 신고" 방식).
- 로그인 성공 시 잠금화면 숨기고 `initApp()` 호출, 인사말(`복 많이 받으세요, {이름}님`) 표시.
- 로그아웃은 `currentUser`를 지우고 잠금화면으로 복귀만 함(Firebase 리스너는 끊지 않음 — `appInitialized` 플래그로 최초 1회만 리스너 등록).
- 로그인 성공 시 이름을 `localStorage`(`connectorAuthUser`)에 저장해두고, 페이지 로드 시 즉시 IIFE(`tryAutoLogin`)로 저장값을 확인해 있으면 잠금화면을 건너뛰고 바로 `initApp()`을 호출 — 매번 재로그인할 필요 없이 자동 로그인됨. 로그아웃 시에만 `localStorage` 값을 지움.

## 2. 데이터 모델 (Firebase RTDB 경로)

```
/contacts/{contactId}
  name, phone, org, topic
  mainGuide            // 메인 인도자 (문자열, 보통 등록자 이름)
  subGuide             // 서브 인도자 배열(string[]) — 구버전 호환용 comma-split 파싱도 지원
  connectAt            // "YYYY-MM-DDTHH:mm" 연결 날짜/시간
  trait                // 특징 (자유 텍스트, 여러 줄)
  createdBy, updatedBy, updatedAt

/appointments/{apptId}
  contactId            // contacts의 키 참조
  apptDate, apptTime, memo
  createdBy, updatedBy, updatedAt

/validations/{validationId}
  contactId            // contacts의 키 참조
  date                 // 해당 회차 미팅 날짜(YYYY-MM-DD)
  topic                // 해당 회차에 진행한 공부주제
  createdBy, updatedBy, updatedAt
```

- `validations`는 연결자당 **2차 이후** 회차만 저장한다. 1차는 별도 저장 없이 `contacts/{id}`의 `connectAt`/`topic`을 그대로 재사용(연결 등록 시점 = 1차 미팅으로 취급).
- `database.rules.json`: `.read: true`, `.write: true` — 인증 없이 전체 공개/쓰기 가능한 규칙. 보안은 전적으로 클라이언트단 비밀번호 잠금에 의존(사실상 URL/DB endpoint를 아는 사람은 누구나 직접 접근 가능한 구조). `validations` 경로도 동일한 전체 공개 규칙을 그대로 상속받으므로 별도 규칙 추가 불필요.

## 3. 실시간 동기화

- `db.ref('contacts').on('value', ...)`, `db.ref('appointments').on('value', ...)`, `db.ref('validations').on('value', ...)` 로 항상 최신 스냅샷을 `contacts`/`appointments`/`validations` 전역 객체에 반영 후 관련 뷰(`renderContacts`/`renderAppointments`/`renderAllContacts`/`renderValidations`)를 재렌더링. `contacts`가 바뀌면 이름/인도자 표시가 걸린 4개 렌더 함수를 모두 다시 부름.
- `setInterval(renderAppointments, 30000)`: 데이터 변경이 없어도 시간 경과에 따라 "임박도"와 "지난 약속 → 보관함" 전환이 자동 반영되도록 30초마다 재계산.

## 4. 화면 구성 (탭 3개: 연결자 / 약속 / 유효, `.view` 토글 + 하단 tabbar)

### 4-1. 연결자 탭 (`contactsView`)
탭 내부에 서브탭 2개(`switchContactSubView`)로 구성:

**내 연결자** (`myContactsBlock`, 기본 활성)
- 내가 **메인 인도자이거나 서브 인도자인** 연결자만 표시 (`isMainGuide` / `isSubGuide`, 대소문자 무시 trim 비교).
- 연결 날짜(`connectAt`) **내림차순 정렬**(`sortByConnectAt`) — 최신 연결이 먼저 보임.
- 검색창: 이름/전화번호/소속/공부주제/메인·서브인도자/연결일시/특징 문자열 전체를 lower-case 포함검색.
- 카드 배경색으로 관계 구분: 내가 메인 인도자면 `guide-main`(연두), 서브 인도자면 `guide-sub`(연한 연두).
- 카드 상단 탭 색상은 `tabColors` 4색 순환(인덱스 기반, 의미 없는 시각적 구분).
- 날짜 표시는 `formatDateWithWeekday`로 요일을 괄호 병기 (예: `2026-07-07(화)`).
- 각 카드에 수정/삭제 버튼. 삭제 시 확인창 후 해당 연결자와 **연결된 모든 약속 + 유효 기록도 함께 삭제**.

**전체 연결 현황** (`allContactsBlock`)
- 필터 없이 **모든 사용자의 전체 연결자**를 노출(등록자 무관), 수정/삭제 버튼 없음(읽기 전용).
- 단, 내가 메인/서브 인도자인 항목은 동일하게 색상 구분(`guide-main`/`guide-sub`)해서 "내 것"을 한눈에 구분 가능.
- 연결 날짜 **내림차순**(최신 우선) 정렬 + 동일한 검색 로직 + 요일 병기 표시.
- (이전에는 하단 탭바에 별도 최상위 탭이었으나, 현재는 연결자 탭의 서브탭으로 이동됨.)

### 4-2. 약속 탭 (`appointmentsView`)
- **캘린더 + 카드 리스트** 2단 구성. 캘린더 선택 여부와 무관하게 카드 리스트는 항상 전체 약속을 보여줌(날짜 클릭은 필터가 아니라 별도 팝업 상세보기).
- **월간 캘린더** (`renderCalendar`, 애플 캘린더 스타일):
  - 날짜 숫자는 셀 우측 상단, 오늘 날짜는 원형 배지로 강조.
  - 그리드는 `grid-template-columns: repeat(7, minmax(0,1fr))` + 셀 `overflow:hidden`으로 콘텐츠가 셀을 밀어 오버플로우 나는 것을 방지(과거 `aspect-ratio` 정사각형 셀에서 오버플로우 버그가 있었음).
  - 하루에 약속이 있으면 연결자별로 **문자열 해시 → HSL 색상**(`colorForString`)을 입힌 둥근 사각형 칩(`cal-chip`)을 표시. 같은 연결자의 약속이 여러 건이어도 `contactId` 기준 dedup으로 칩은 1개만.
  - 칩은 셀당 최대 `CAL_MAX_CHIPS`(2)개까지만 그리고, 초과분은 `+N` 텍스트로 축약(정렬 기준은 시간순이 아니라 데이터 등장 순서 — 필요시 개선 여지 있음). 실제 상세 정보 손실은 없음(아래 팝업이 전부 보여줌).
  - 날짜 셀 클릭 시 `openDayModal(dateStr)` → `#dayModal` 팝업에 그 날짜의 모든 약속 카드를 시간순으로 표시(카드 리스트 필터링과 무관한 별도 상세보기).
  - `calPrevMonth`/`calNextMonth`/`calToday`로 월 이동, `ensureCalendarState`가 최초 진입 시 현재 월로 초기화.
- 카드 리스트(`renderCard`, 최상위 함수로 분리되어 있어 메인 리스트/보관함/팝업에서 공용):
  - 대상 연결자가 아직 존재하는 약속만 노출(고아 데이터 방지).
  - 현재 시각(`nowKey`) 기준으로 예정(`upcoming`)과 지난 약속(`past`)으로 분리:
    - 예정: 날짜/시간 오름차순(임박순), 메인 리스트에 항상 표시.
    - 지난 약속: 날짜/시간 내림차순, "지난 약속 보관함" 토글 버튼 뒤에 숨김 표시(`toggleArchive`).
  - 검색은 연결자 정보 + 약속 날짜/시간/메모까지 포함, 캘린더 칩 표시에도 동일 검색 필터가 반영됨(`renderCalendar(ids)`에 검색 필터링된 id 목록을 넘김).
  - 카드도 연결자 탭과 동일하게 **메인/서브 인도자 배경색 구분**(`guide-main`/`guide-sub`)이 적용됨.
  - **임박도(urgency) 로직** (`urgencyInfo`):
    - 목표 시각 - 현재 시각 < 0 → null (뱃지 없음, 이미 지남 → 보관함으로)
    - < 60분 → `critical` (빨강 테두리+글로우, "N분 후")
    - < 24시간 → `soon` (주황 테두리, "N시간 후")
    - < 3일 → `upcoming` (연한 회색 테두리, "N일 후")
    - 그 이상 → null (강조 없음)
  - 날짜 표시는 "약속 날짜" 한 줄에 `apptDate`+`apptTime`을 합쳐(`[a.apptDate, a.apptTime].filter(Boolean).join('T')`) `formatDateWithWeekday`로 요일까지 병기 — 연결 날짜와 동일하게 날짜/요일/시간이 한 필드에 표시됨(예전엔 "약속 날짜"/"약속 시간" 두 줄로 분리돼 있었음). 단, 등록/수정 모달의 입력 필드(`aDate`/`aTime`)는 그대로 date/time 두 개로 분리되어 있음 — 표시만 합쳐짐.
- 등록/수정 모달의 연결자 select는 내가 관련된(메인/서브) 연결자만 옵션으로 노출(`populateContactSelect`), 표시 형식은 5번 참고.

### 4-3. 유효 탭 (`validationsView`)
- "유효"(주기적 방문/스터디 확인 미팅) 진행 이력을 연결자별로 회차 단위로 기록하는 탭. **모든 사용자에게 공유**(등록자 무관 전체 노출, 등록/수정/삭제 권한만 메인·서브 인도자로 제한).
- **1차는 항상 연결자 등록 정보(`connectAt`/`topic`)를 그대로 사용**하고 `validations` 노드에는 저장하지 않음. `validations`에는 **2차부터**의 회차만 저장됨.
- 유효가 1건이라도 있는(즉 `validations`에 최소 1개 회차가 있는) 연결자만 목록에 노출(`registeredIds`). 정렬은 **가장 최근 회차 날짜 내림차순**(`latestValidationDate`).
- 카드에는 연결자 기본 정보(이름/전화/소속/메인·서브 인도자) + 회차별 히스토리(`validation-item`, 1차부터 N차까지 전부, 회차 번호는 `ROUND_COLORS`(빨강/노랑/초록, 3차 이후는 초록 고정) 색 점과 함께 표시).
- **등록/수정 모달**(`#validationModal`):
  - 연결자 select(`vContactId`, 신규 등록 시 특정 연결자를 프리셋 가능) — 표시 형식은 5번 참고. select 변경 시 `loadValidationRoundsForContact`가 해당 연결자의 기존 2차 이후 회차를 다시 불러옴.
  - 회차 입력 행(`#vRoundList`, `addValidationRoundRow`/`renumberValidationRounds`)은 **항상 "2차"부터 라벨링**됨(`idx+2`) — 1차는 폼에 아예 나타나지 않고 수정 불가(1차를 바꾸려면 연결자 정보 자체를 수정해야 함). 신규 등록 시에도 기본으로 빈 행 1개가 "2차"로 표시됨.
  - `+ 회차 추가` 버튼으로 행을 계속 늘릴 수 있고, 각 행 우측 ✕ 버튼으로 삭제 가능(삭제 시 회차 번호 자동 재계산).
  - 저장(`saveValidation`) 시: 폼에 남아있는 행 중 기존 `id`가 있으면 `update`, 없으면 신규 `push().set()`. 폼에서 삭제된(더 이상 존재하지 않는) 기존 회차는 `db.ref('validations/'+id).remove()`로 정리 — 즉 폼 상태가 곧 그 연결자의 전체 2차 이후 회차 목록의 진실源.
  - 카드의 "삭제" 버튼(`deleteAllValidations`)은 해당 연결자의 2차 이후 회차를 전부 삭제(1차 정보 자체는 연결자 데이터라 안 지워짐).
- 연결자 삭제(`deleteContact`) 시 관련 `validations` 레코드도 함께 정리됨(2번 데이터 모델 참고).

## 5. 모달 & 입력 로직

- **연결자 모달**: 이름(필수)/전화/소속/공부주제/메인인도자(신규 등록 시 기본값 = `currentUser`)/서브인도자(동적 행 추가·삭제 `addSubGuideRow`/`getSubGuideValues`)/연결 날짜·시간(기본값 오늘/지금)/특징(자동 높이조절 textarea).
- **약속 모달**: 연결자 select(필수)/약속 날짜·시간(기본 오늘/지금)/메모.
- **유효 모달**: 연결자 select(필수) + 회차별(2차~) 날짜/공부주제 행 목록. 상세는 4-3 참고.
- **연결자 select 표시 형식** (`contactOptionLabel`, 약속·유효 모달 공용): `이름 - 메인인도자, 서브인도자, 서브인도자` 형태로 표시(인도자 정보가 하나도 없으면 이름만). 여러 연결자 중 인도자 조합으로 빠르게 구분하기 위함.
- 저장 시 `updatedBy`/`updatedAt` 항상 갱신, 신규 생성 시 `createdBy` 추가. 수정은 `update()`(부분 병합), 신규는 `push().set()`.
- `saveContact`/`saveAppt`/`saveValidation`에는 클라이언트 측 최소 검증만 존재(이름/연결자 선택 필수, 유효는 회차 행이 1개 이상 있거나 기존 회차가 있어야 함) — 그 외 필드는 전부 선택.

## 6. 공용 유틸

- `escapeHtml`: 모든 사용자 입력을 렌더링 전 XSS 이스케이프 처리.
- `todayDateValue`/`nowTimeValue`: 로컬 타임존 보정 후 `YYYY-MM-DD`/`HH:mm` 문자열 생성(폼 기본값용).
- `formatDateWithWeekday`: `YYYY-MM-DD` 또는 `YYYY-MM-DDTHH:mm` 값에 한글 요일을 괄호로 병기해서 반환(연결 날짜/약속 날짜 표시에 공용 사용).
- `matchesSearch`: 필드 배열을 공백조인 후 lower-case 부분일치.
- `subGuideArray`: 배열/콤마문자열 두 형태 모두 지원(과거 데이터 호환).
- `colorForString`: 문자열(연결자 이름)을 해시해 `hsl(...)` 색상으로 변환 — 캘린더 칩 색상 배정에 사용, 같은 이름은 항상 같은 색.
- `contactOptionLabel`: 연결자 select 옵션 라벨 생성(`이름 - 메인, 서브...`), 약속/유효 모달 공용.

## 7. Firebase 설정 & 배포

- 프로젝트 ID: `paw-hello-sy`, RTDB 리전: `europe-west1`.
- `firebaseConfig`(apiKey 포함)가 `index.html`에 평문 노출되어 있으나, RTDB 규칙 자체가 완전 공개이므로 apiKey 은닉 여부는 실질적 의미 없음(공개 앱 특성상 정상적인 패턴).
- `firebase.json`은 database rules 경로만 지정 — Hosting 설정은 없음. **실제 배포는 GitHub Pages**(`jsha2217/e186101d` 저장소, `master` 브랜치, 루트 경로) — https://jsha2217.github.io/e186101d/ 로 서비스되며, `master`에 push하면 별도 빌드/승인 절차 없이 자동 반영(보통 1~2분 내).

## 8. 세션 변경 이력

### 2026-07-07
이 대화에서 `index.html`에 순차적으로 반영한 내용:

1. **공유 캘린더 추가**: 약속 탭 상단에 월간 캘린더 신설. 처음엔 날짜 클릭 시 카드 리스트를 그 날짜로 필터링하는 방식으로 만들었으나, 이후 요구사항에 맞게 **리스트는 항상 전체 표시, 날짜 클릭은 별도 팝업(`#dayModal`)으로 상세 조회**하는 방식으로 재설계.
2. **날짜에 요일 표시**: `formatDateWithWeekday` 추가, 연결 날짜/약속 날짜 전체에 적용.
3. **캘린더 오버플로우 버그 수정 + 애플 캘린더 스타일 재설계**: `aspect-ratio` 정사각형 셀 → 고정 min-height 셀로 변경, 그리드 컬럼에 `minmax(0,1fr)` 적용(그리드 콘텐츠 밀림 방지). 날짜 숫자를 셀 우측 상단에 배치, 연결자별 색상은 원형 점 → 문자열 해시 기반 색상의 **둥근 사각형 칩**으로 변경(`colorForString`, 셀당 최대 2개 + `+N` 축약).
4. **연결자 / 전체 연결 현황 정렬 변경**: 연결 날짜 오름차순 → **내림차순**(최신 우선)으로 변경(`sortByConnectAt` 비교 방향 반전).
5. **약속 카드에도 인도자 색상 구분 적용**: `renderCard`(약속 리스트/보관함/날짜 팝업 공용 함수)에 연결자 탭과 동일한 `guide-main`/`guide-sub` 배경색 클래스 추가.
6. **자동 로그인 유지**: 로그인 성공 시 이름을 `localStorage`에 저장, 페이지 로드 시 저장값이 있으면 잠금화면을 건너뛰고 바로 앱으로 진입(`tryAutoLogin`). 로그아웃 시에만 저장값 삭제.
7. **약속 카드 날짜/시간 표기 통합**: "약속 날짜"와 "약속 시간"으로 나뉘어 있던 두 줄을 연결 날짜와 같은 방식(날짜+요일+시간 한 줄)으로 합침. 등록/수정 모달의 입력 필드는 변경 없음(표시만 통합).
8. **GitHub 반영**: `index.html`, `PROJECT_LOGIC.md` 변경사항을 커밋 후 `origin/master`에 푸시. 커밋 전 diff를 검토해 Firebase 설정(`apiKey`/`databaseURL`)·데이터 스키마·삭제(`remove`)/쓰기(`set`/`update`) 로직이 전혀 변경되지 않았음을 확인 — 이번 배포로 인해 기존 Firebase RTDB 데이터(`contacts`/`appointments`)가 영향받을 위험은 없음.
9. **`preview.html` 제거**: 로컬 더미 데이터 미리보기용 별도 파일이었으나, `index.html` 하나만 유지하는 것으로 정리(미리보기도 `index.html`을 직접 열어서 확인). `.gitignore`도 함께 삭제(다른 항목 없었음).

구현 중 확인된 이슈: 캘린더 관련 코드를 여러 차례 리팩터링하는 과정에서 `renderAppointments` 내부 로직(예정/지난 약속 분리, 보관함 표시)이 실수로 한 번 삭제됐다가 다시 복원된 이력이 있음 — 현재는 정상 동작 확인됨(문법 검사 통과, 코드 리뷰로 재확인).

### 2026-07-12
1. **"유효" 탭 신설**: 연결자별 2차 이후 스터디/미팅 회차를 기록하는 `validations` RTDB 노드 + 신규 탭 추가(4-3 참고). 1차는 연결자 등록 정보(`connectAt`/`topic`)를 그대로 재사용하고 별도 저장하지 않음 — 등록/수정 모달의 회차 입력은 항상 "2차"부터 라벨링되어 1차는 폼에서 아예 수정 불가하도록 설계.
2. **탭 구조 변경**: 기존 최상위 탭이던 "전체 연결 현황"을 "연결자" 탭의 서브탭(`switchContactSubView`)으로 이동시키고, 하단 tabbar의 그 자리를 새 "유효" 탭이 대신함. 최상위 탭은 여전히 3개(연결자/약속/유효).
3. **연결자 select 표시 형식 변경**: 약속·유효 등록/수정 모달의 연결자 드롭다운이 이름만 보여주던 것을 `contactOptionLabel`로 `이름 - 메인인도자, 서브인도자` 형식으로 변경.
4. **`preview.html`/`.gitignore` 관련 문서 정리**: 실제 파일이 이미 로컬에도 없는 상태라 문서상 흔적만 정리.
5. **배포 경로 확인 및 문서화**: 이 저장소는 GitHub Pages(`master` 브랜치)로 서비스되고 있음을 확인(`https://jsha2217.github.io/e186101d/`) — push 후 별도 조치 없이 자동 반영됨을 7번 섹션에 명시.

각 변경사항은 커밋 전 diff 검토로 Firebase 설정/기존 `contacts`/`appointments` 스키마·CRUD 로직이 변경되지 않았음을 확인 후 `origin/master`에 푸시함(`validations`는 신규 노드라 기존 데이터에 영향 없음).
