# 프로젝트 로직 총정리 — 연결자 관리

빌드 시스템 없는 순수 정적 HTML/JS 앱. 백엔드는 Firebase Realtime Database.
파일 구성:
- `index.html` — 화면 구조와 정적 스크립트 연결.
- `styles.css` — 전체 화면 스타일.
- `js/core.js` — 세션, Firebase 구독, 쓰기 오류 처리, 공용 렌더 유틸.
- `js/contacts.js`, `js/appointments.js`, `js/validations.js` — 기능별 화면·입력 로직.
- `js/bootstrap.js` — 선언형 `data-action`/`data-render` 이벤트 연결과 자동 로그인 시작.
- `js/paging.js` — Firebase 15건 조회, 스크롤 추가 로딩, 월간 달력 범위 조회, 조회 인덱스 전환.
- `tests/app.test.js` — 모의 Firebase 기반 핵심 동작 테스트 (`node --test tests/app.test.js`).
- `firebase.json`, `.firebaserc`, `database.rules.json` — Firebase RTDB 설정 (Hosting 설정은 없음, 아래 7번 참고)
- `vendor/firebase/` — Firebase SDK(`firebase-app-compat.js`, `firebase-database-compat.js`)를 CDN이 아닌 로컬 파일로 벤더링(7번 참고).
- `assets/home-bg.jpg` — 잠금화면 배경 이미지.
- `scripts/set-baptism.sh` — `contacts.baptism` 필드를 터미널에서 직접 조작하는 스크립트(2번 데이터 모델 참고). 인자 없이 실행하면 백필, `<contactId> <0|1>`로 실행하면 특정 연결자 값 설정.
- `scripts/migrate-pagination.mjs` — 기존 RTDB 기록의 목록 인덱스 및 약속 복합 날짜를 백필. 기본은 읽기 전용, `--apply`일 때만 기록.

## 1. 인증 (잠금 화면)

- 로그인은 "이름"(자유 텍스트, 사용자 식별자 역할) + "전체 공용 비밀번호" 2개 입력.
- 비밀번호를 SHA-256 해시하여 하드코딩된 `CORRECT_HASH`와 비교. 이름 자체는 검증하지 않고 단순히 `currentUser`로 저장되어 이후 모든 "내 연결자/약속" 필터링의 키로 사용됨 (즉 이름을 다르게 입력하면 다른 사람 행세 가능 — 진짜 인증이 아니라 "우리 팀만 아는 공용 비밀번호 + 자기 이름 자율 신고" 방식).
- 로그인 성공 시 잠금화면 숨기고 `initApp()` 호출, 인사말(`복 많이 받으세요, {이름}님`) 표시.
- 로그아웃 시 Firebase 리스너와 30초 타이머를 해제하고 메모리의 데이터 스냅샷을 지움. 다른 이름으로 다시 로그인하면 새 구독과 사용자별 필터를 적용함.
- 로그인 성공 시 이름을 `localStorage`(`connectorAuthUser`)에 저장함. 모든 스크립트가 로드된 뒤 `js/bootstrap.js`에서 저장값을 확인해 자동 로그인함. 로그아웃 시 저장값을 지움.

## 2. 데이터 모델 (Firebase RTDB 경로)

```
/contacts/{contactId}
  name, phone, org, topic
  mainGuide            // 메인 인도자 (문자열, 보통 등록자 이름)
  subGuide             // 서브 인도자 배열(string[]) — 구버전 호환용 comma-split 파싱도 지원
  connectAt            // "YYYY-MM-DDTHH:mm" 연결 날짜/시간
  trait                // 특징 (자유 텍스트, 여러 줄)
  baptism              // 0 또는 1 (침례 여부). 신규 등록 시 항상 0으로 생성.
                        // 값 변경은 scripts/set-baptism.sh로 터미널에서 직접 DB를 조작해야만
                        // 가능 — 모달에는 입력 필드가 없음. 단, 값이 1이면 연결자/약속/유효
                        // 세 탭의 카드 모두 골드 테두리+뱃지로 시각적으로 강조됨(5-1번 참고).
  createdBy, updatedBy, updatedAt

/appointments/{apptId}
  contactId            // contacts의 키 참조
  apptDate, apptTime, memo
  apptAt               // "YYYY-MM-DDTHH:mm", 15건 약속 조회용
  createdBy, updatedBy, updatedAt

/validations/{validationId}
  contactId            // contacts의 키 참조
  date                 // 해당 회차 미팅 날짜(YYYY-MM-DD)
  topic                // 해당 회차에 진행한 공부주제
  createdBy, updatedBy, updatedAt

/guideContacts/{guideKey}/{all|main|sub}/{contactId}
  connectAt            // 인도자별 연결자 목록 조회 인덱스

/validationSummaries/{contactId}
  firstDate, latestDate, count

/meta/paginationVersion
  1                    // 인덱스 백필 완료 후 페이지 조회 활성화
```

- `validations`는 연결자당 **2차 이후** 회차만 저장한다. 1차는 별도 저장 없이 `contacts/{id}`의 `connectAt`/`topic`을 그대로 재사용(연결 등록 시점 = 1차 미팅으로 취급).
- `database.rules.json`: `.read: true`, `.write: true` — 인증 없이 전체 공개/쓰기 가능한 규칙. 보안은 전적으로 클라이언트단 비밀번호 잠금에 의존(사실상 URL/DB endpoint를 아는 사람은 누구나 직접 접근 가능한 구조). `validations` 경로도 동일한 전체 공개 규칙을 그대로 상속받으므로 별도 규칙 추가 불필요.

## 3. 실시간 동기화

- `paginationVersion===1`이면 연결자는 인도자 인덱스, 약속은 `apptAt`, 유효는 `validationSummaries.latestDate` 순서로 첫 15건을 조회한다. 목록 끝에 스크롤하면 다음 15건을 요청한다. 첫 페이지에는 제한된 실시간 리스너를 둔다. 다른 탭은 열 때 처음 조회한다.
- 달력은 펼쳤을 때 해당 월의 약속 날짜 또는 유효 최초 달성일만 조회한다. 검색·관계 필터·기본 이외 정렬을 사용하면 정확한 전체 결과를 위해 그 세 경로를 한 번 읽고 해당 세션에서 재사용한다. 따라서 **전체 검색은 비용상 예외**다.
- 인덱스 이전의 DB에서는 기존 전체 구독 방식으로 동작한다. 인덱스와 `apptAt` 백필이 끝난 뒤 `paginationVersion=1`이 되면 새로 로그인/새로고침하는 세션부터 페이지 조회로 전환된다.
- `setInterval(renderAppointments, 30000)`: 시간 경과에 따른 임박도와 보관함 전환을 갱신함. 로그아웃 시 타이머를 해제함.

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
- 카드 첫 화면에는 이름·관계·소속·연결일과, 있으면 다음 약속·최근 유효일을 표시한다. 나머지 정보는 `상세 정보 보기`에서 펼친다. 관계 필터, 최신/오래된/이름순 정렬을 제공하며 목록은 15건씩 스크롤 또는 `더 보기`로 늘어난다.

**전체 연결 현황** (`allContactsBlock`)
- 필터 없이 **모든 사용자의 전체 연결자**를 노출(등록자 무관), 수정/삭제 버튼 없음(읽기 전용).
- 단, 내가 메인/서브 인도자인 항목은 동일하게 색상 구분(`guide-main`/`guide-sub`)해서 "내 것"을 한눈에 구분 가능.
- 연결 날짜 **내림차순**(최신 우선) 정렬 + 동일한 검색 로직 + 요일 병기 표시.
- (이전에는 하단 탭바에 별도 최상위 탭이었으나, 현재는 연결자 탭의 서브탭으로 이동됨.)
- 전체 목록에도 동일한 검색·관계 필터·정렬·15건씩 보기 기능을 제공한다.

### 4-2. 약속 탭 (`appointmentsView`)
- **캘린더 + 카드 리스트** 2단 구성. 캘린더 선택 여부와 무관하게 카드 리스트는 항상 전체 약속을 보여줌(날짜 클릭은 필터가 아니라 별도 팝업 상세보기).
- **월간 캘린더** (`renderCalendar`, 애플 캘린더 스타일):
  - 날짜 숫자는 셀 우측 상단, 오늘 날짜는 원형 배지로 강조.
  - 그리드는 `grid-template-columns: repeat(7, minmax(0,1fr))` + 셀 `overflow:hidden`으로 콘텐츠가 셀을 밀어 오버플로우 나는 것을 방지(과거 `aspect-ratio` 정사각형 셀에서 오버플로우 버그가 있었음).
  - 하루에 약속이 있으면 연결자별로 **문자열 해시 → HSL 색상**(`colorForString`)을 입힌 둥근 사각형 칩(`cal-chip`)을 표시. 같은 연결자의 약속이 여러 건이어도 `contactId` 기준 dedup으로 칩은 1개만.
  - 칩은 셀당 최대 `CAL_MAX_CHIPS`(2)개까지만 그리고, 초과분은 `+N` 텍스트로 축약(정렬 기준은 시간순이 아니라 데이터 등장 순서 — 필요시 개선 여지 있음). 실제 상세 정보 손실은 없음(아래 팝업이 전부 보여줌).
  - 약속이 있는 날짜만 버튼으로 제공한다. 클릭 시 `openDayModal(dateStr)` → `#dayModal` 팝업에 그 날짜의 모든 약속 카드를 시간순으로 표시(카드 리스트 필터링과 무관한 별도 상세보기).
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
- 등록/수정 모달의 연결자 select는 내가 관련된(메인/서브) 연결자만 옵션으로 노출(`populateContactSelect`). 신규 등록 시에는 빈 안내 항목을 기본 선택해 연결자를 직접 고르게 함.
- 등록/수정 시 연결자·날짜·시간을 모두 요구한다. 연결자 선택창 위의 검색 입력으로 이름과 인도자를 좁힐 수 있다. 예정/지난 약속은 각각 15건씩 표시하고 더 볼 수 있다.

### 4-3. 유효 탭 (`validationsView`)
- "유효"(주기적 방문/스터디 확인 미팅) 진행 이력을 연결자별로 회차 단위로 기록하는 탭. **모든 사용자에게 공유**(등록자 무관 전체 노출, 등록/수정/삭제 버튼은 메인·서브 인도자에게만 표시). 이는 UI 제한이며 RTDB 규칙 차원의 권한 제어는 아님.
- **월간 캘린더**(`renderValidationCalendar`, 약속 탭 캘린더와 별개의 독립 상태 `vCalYear`/`vCalMonth`): 연결자별 **2차(=최초 유효) 달성일**에 스마일 아이콘을 표시(`validationAnchorInfo`가 각 연결자의 가장 이른 2차 이후 회차 날짜와 "3차 이상 진행 여부"를 계산). 아직 3차가 없으면 노랑, 3차 이상 진행됐으면 초록 스마일로 같은 날짜 자리에서 색만 전환. 같은 날짜에 여러 명이면 아이콘이 나란히 표시되고 셀당 최대 `CAL_MAX_ICONS`(4)개, 초과분은 `+N`으로 축약. 날짜 클릭 시 `openValidationDayModal`로 해당 날짜에 2차를 달성한 연결자들의 카드를 `#vDayModal` 팝업에 표시(`renderValidationCard`로 카드 렌더링 공용화 — 리스트/팝업 공유).
- **1차는 항상 연결자 등록 정보(`connectAt`/`topic`)를 그대로 사용**하고 `validations` 노드에는 저장하지 않음. `validations`에는 **2차부터**의 회차만 저장됨.
- 유효가 1건이라도 있는(즉 `validations`에 최소 1개 회차가 있는) 연결자만 목록에 노출(`registeredIds`). 정렬은 **가장 최근 회차 날짜 내림차순**(`latestValidationDate`).
- 카드에는 연결자 기본 정보(이름/전화/소속/메인·서브 인도자) + 회차별 히스토리(`validation-item`, 1차부터 N차까지 전부, 회차 번호는 `ROUND_COLORS`(빨강/노랑/초록, 3차 이후는 초록 고정) 색 점과 함께 표시).
- 목록 카드에는 이름·진행 차수·최근 날짜를 먼저 보여 주고, 회차와 연결자 정보는 펼쳐서 확인한다. 목록은 15명씩 표시한다. 캘린더는 기록이 있는 날짜만 상세 버튼을 제공한다.
- **등록/수정 모달**(`#validationModal`):
  - 연결자 select(`vContactId`, 신규 등록 시 특정 연결자를 프리셋 가능) — 표시 형식은 5번 참고. 프리셋 없이 신규 등록할 때는 빈 placeholder("연결자를 선택해주세요")가 기본 선택되어 있어 **연결자를 직접 골라야만** 회차 입력란이 나타남(자동으로 첫 연결자가 선택되어 실수로 엉뚱한 연결자에 등록되는 것을 방지). select 변경 시 `loadValidationRoundsForContact`가 해당 연결자의 기존 2차 이후 회차를 다시 불러옴(선택 해제 시 회차 입력란도 비움).
  - 회차 입력 행(`#vRoundList`, `addValidationRoundRow`/`renumberValidationRounds`)은 **항상 "2차"부터 라벨링**됨(`idx+2`) — 1차는 폼에 아예 나타나지 않고 수정 불가(1차를 바꾸려면 연결자 정보 자체를 수정해야 함). 신규 등록 시에도 기본으로 빈 행 1개가 "2차"로 표시됨.
  - `+ 회차 추가` 버튼으로 행을 계속 늘릴 수 있고, 각 행 우측 ✕ 버튼으로 삭제 가능(삭제 시 회차 번호 자동 재계산).
  - 저장(`saveValidation`) 시: 회차 날짜는 필수다. 폼에 남은 기존 회차의 메타데이터를 유지하고, 신규 행에는 새 키를 생성함. 삭제된 행은 `null`로 설정한 뒤 모든 변경을 루트의 다중 경로 `update()` 한 번으로 적용함. 일부 회차를 지우면 건수를 확인하고, 전체 삭제는 일반 저장에서 차단한다. 폼 상태가 그 연결자의 전체 2차 이후 회차 목록이 됨.
  - 카드의 "삭제" 버튼(`deleteAllValidations`)은 해당 연결자의 2차 이후 회차를 전부 삭제(1차 정보 자체는 연결자 데이터라 안 지워짐).
- 연결자 삭제(`deleteContact`) 시 관련 `validations` 레코드도 함께 정리됨(2번 데이터 모델 참고).

## 5. 모달 & 입력 로직

- **연결자 모달**: 이름(필수)/전화/소속/공부주제/메인인도자(신규 등록 시 기본값 = `currentUser`)/서브인도자(동적 행 추가·삭제 `addSubGuideRow`/`getSubGuideValues`)/연결 날짜·시간(기본값 오늘/지금)/특징(자동 높이조절 textarea).
- **약속 모달**: 연결자 select(필수)/약속 날짜·시간(기본 오늘/지금)/메모.
- **유효 모달**: 연결자 select(필수) + 회차별(2차~) 날짜/공부주제 행 목록. 상세는 4-3 참고.
- **연결자 select 표시 형식** (`contactOptionLabel`, 약속·유효 모달 공용): `이름 - 메인인도자, 서브인도자, 서브인도자` 형태로 표시(인도자 정보가 하나도 없으면 이름만). 여러 연결자 중 인도자 조합으로 빠르게 구분하기 위함.
- 저장 시 `updatedBy`/`updatedAt`을 갱신하고 신규 생성에 `createdBy`를 추가함. 연결자·약속 수정은 `update()`, 신규 생성은 `push().set()`을 사용함. 유효 회차 추가·수정·삭제와 연결자 연쇄 삭제는 루트의 다중 경로 `update()` 한 번으로 묶음. 쓰기에 실패하면 편집 모달을 열어 둠.
- 연결자는 이름·메인 인도자·연결 날짜, 약속은 연결자·날짜·시간, 유효는 연결자·각 회차 날짜가 필수다. 누락된 입력은 해당 필드 옆에 오류를 표시한다.
- 모달은 `role="dialog"`, 제목 연결, 초기 초점, 초점 이동 가두기, Escape·바깥 클릭 닫기를 지원한다. 양식이 변경된 상태에서 닫거나 유효 연결자를 바꾸면 확인창을 띄운다. 날짜 상세에서 편집창을 열면 편집창이 위에 표시되고, 저장/삭제 뒤 상세가 갱신된다.
- 데이터 수신 전에는 로딩 문구를 표시한다. 저장 중에는 제출 버튼을 비활성화하고, 완료·실패 상태를 상단 알림으로 표시한다. 모바일에서는 달력을 기본으로 접고, 회차 날짜와 주제를 두 줄에 배치한다.

## 6. 공용 유틸

- `escapeHtml`: 모든 사용자 입력을 렌더링 전 XSS 이스케이프 처리.
- `todayDateValue`/`nowTimeValue`: 로컬 타임존 보정 후 `YYYY-MM-DD`/`HH:mm` 문자열 생성(폼 기본값용).
- `formatDateWithWeekday`: `YYYY-MM-DD` 또는 `YYYY-MM-DDTHH:mm` 값에 한글 요일을 괄호로 병기해서 반환(연결 날짜/약속 날짜 표시에 공용 사용).
- `matchesSearch`: 필드 배열을 공백조인 후 lower-case 부분일치.
- `subGuideArray`: 배열/콤마문자열 두 형태 모두 지원(과거 데이터 호환).
- `colorForString`: 문자열(연결자 이름)을 해시해 `hsl(...)` 색상으로 변환 — 캘린더 칩 색상 배정에 사용, 같은 이름은 항상 같은 색.
- `contactOptionLabel`: 연결자 select 옵션 라벨 생성(`이름 - 메인, 서브...`), 약속/유효 모달 공용.
- `baptizedClass(c)`/`baptizedBadge(c)`: `c.baptism === 1`일 때 카드에 `baptized` 클래스와 골드 뱃지 HTML을 반환(둘 다 아니면 빈 문자열). 연결자(내 연결자/전체 연결 현황)·약속·유효 4곳의 카드 렌더 함수 전부에서 공용으로 호출.
- **`baptized` 카드 스타일**: 골드 테두리와 3.6초 주기 후광 애니메이션(`baptized-aura`). `prefers-reduced-motion: reduce`에서는 애니메이션을 끔. 뱃지는 카드 좌상단, 임박도 뱃지는 우상단에 배치.

## 7. Firebase 설정 & 배포

- 프로젝트 ID: `paw-hello-sy`, RTDB 리전: `europe-west1`.
- `firebaseConfig`(apiKey 포함)는 `js/core.js`에 있음. 클라이언트 앱의 설정값은 공개되며, RTDB 규칙이 완전 공개라 실제 접근 제어가 없음. 인증과 규칙 교체는 별도 데이터 접근 설계가 필요함.
- Firebase SDK는 CDN(`gstatic.com`)이 아닌 `vendor/firebase/`에 로컬로 벤더링되어 있음 — 일부 Safari 콘텐츠 차단 확장(AdGuard, 1Blocker 등)이 `gstatic.com`/`googleapis.com` 요청을 도메인 단위로 차단해 SDK 로드 자체가 실패하고 데이터가 아예 렌더링되지 않는 문제가 있었음. 같은 origin에서 서빙하면 이 차단을 피할 수 있음.
- 15건 조회를 적용할 때는 `database.rules.json`의 조회 인덱스를 Firebase에 배포하고, 코드 배포 후 `scripts/migrate-pagination.mjs --apply`로 기존 기록을 백필해야 한다. 백필 전에는 구버전 전체 조회를 유지한다.
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

같은 날 이후 추가된 수정 사항:

10. **Firebase SDK 로컬 벤더링**: 일부 Safari 콘텐츠 차단 확장(AdGuard, 1Blocker 등)이 `gstatic.com`/`googleapis.com`으로의 요청을 도메인 단위로 차단해, 해당 환경에서는 Firebase SDK가 로드되지 않고 데이터가 조용히 아예 렌더링되지 않는 문제가 있었음. SDK 파일을 `vendor/firebase/`에 내려받아 같은 origin에서 서빙하도록 변경.
11. **자동 로그인 크래시 수정**: `tryAutoLogin()` IIFE가 스크립트 파싱 시점에 즉시 실행되며 `initApp()`을 호출했는데, `initApp()`이 참조하는 `const firebaseConfig` 선언이 그보다 ~20줄 아래에 있어 매 새로고침(자동 로그인이 타는 유일한 경로)마다 TDZ `ReferenceError`가 발생, `initApp` 중간에서 조용히 실패해 Firebase 리스너 등록이 안 되는 버그가 있었음(수동 로그인 버튼 클릭은 그 시점엔 스크립트 전체가 이미 끝까지 실행된 후라 문제없었음). `tryAutoLogin` 호출 위치를 `initApp` 및 그 의존값 선언 이후로 이동해서 해결.

### 2026-07-08

1. **홈 배경 이미지 추가**: 잠금화면에 `assets/home-bg.jpg` 배경 이미지 적용.
2. **배경 이미지 티어링 수정**: 처음엔 `body`와 `#lockScreen`에 각각 동일한 배경 이미지를 지정했는데, 두 레이어가 스크롤/리렌더 시 어긋나며 티어링(찢어짐)이 발생. 배경을 `#bgLayer`(항상 `position:fixed; inset:0; z-index:-1`인 별도 레이어 하나)로 일원화하고 `body`/`#lockScreen`은 배경을 갖지 않도록 변경해 뷰포트에 고정된 단일 레이어만 배경을 그리도록 정리.

### 2026-07-12
1. **"유효" 탭 신설**: 연결자별 2차 이후 스터디/미팅 회차를 기록하는 `validations` RTDB 노드 + 신규 탭 추가(4-3 참고). 1차는 연결자 등록 정보(`connectAt`/`topic`)를 그대로 재사용하고 별도 저장하지 않음 — 등록/수정 모달의 회차 입력은 항상 "2차"부터 라벨링되어 1차는 폼에서 아예 수정 불가하도록 설계.
2. **탭 구조 변경**: 기존 최상위 탭이던 "전체 연결 현황"을 "연결자" 탭의 서브탭(`switchContactSubView`)으로 이동시키고, 하단 tabbar의 그 자리를 새 "유효" 탭이 대신함. 최상위 탭은 여전히 3개(연결자/약속/유효).
3. **연결자 select 표시 형식 변경**: 약속·유효 등록/수정 모달의 연결자 드롭다운이 이름만 보여주던 것을 `contactOptionLabel`로 `이름 - 메인인도자, 서브인도자` 형식으로 변경.
4. **`preview.html`/`.gitignore` 관련 문서 정리**: 실제 파일이 이미 로컬에도 없는 상태라 문서상 흔적만 정리.
5. **배포 경로 확인 및 문서화**: 이 저장소는 GitHub Pages(`master` 브랜치)로 서비스되고 있음을 확인(`https://jsha2217.github.io/e186101d/`) — push 후 별도 조치 없이 자동 반영됨을 7번 섹션에 명시.
6. **유효 탭 캘린더 뷰 추가**: 연결자별 2차(최초 유효) 달성 날짜에 스마일 아이콘을 표시하는 월간 캘린더를 유효 탭에 신설(`renderValidationCalendar`, 약속 탭 캘린더와 독립된 `vCalYear`/`vCalMonth` 상태). 3차 이상 진행되면 같은 자리에서 아이콘 색이 노랑→초록으로 전환(`validationAnchorInfo`), 여러 명이 같은 날짜면 아이콘이 나란히 표시(최대 4개, 초과분은 `+N`). 날짜 클릭 시 그 날 2차 달성자 카드를 `#vDayModal` 팝업으로 보여줌 — 이 과정에서 카드 렌더링을 `renderValidationCard`로 함수 분리해 리스트/팝업 공용화.
7. **유효 모달 연결자 select 기본값 변경**: 신규 등록 시 select가 첫 연결자로 자동 선택되어 회차 입력란이 곧바로 뜨던 것을, 빈 placeholder("연결자를 선택해주세요")를 기본값으로 추가해 사용자가 직접 골라야만 입력란이 나타나도록 변경(실수로 엉뚱한 연결자에 등록하는 것 방지).

각 변경사항은 커밋 전 diff 검토로 Firebase 설정/기존 `contacts`/`appointments` 스키마·CRUD 로직이 변경되지 않았음을 확인 후 `origin/master`에 푸시함(`validations`는 신규 노드라 기존 데이터에 영향 없음).

### 2026-08-04
1. **`contacts.baptism` 필드 추가**: 침례 여부를 0/1로 기록하는 필드 신설. **앱 UI에는 입력/표시 화면이 전혀 없음** — 신규 연결자 등록 시(`saveContact`) 항상 0으로 생성되고, 값을 1로 바꾸는 것은 오직 터미널에서 `scripts/set-baptism.sh <contactId> <0|1>`을 직접 실행해야만 가능하도록 의도적으로 설계(값 검증은 스크립트 내부에서 0/1만 허용). 기존 연결자 수정 모달(`saveContact`의 `update()`)은 이 필드를 아예 건드리지 않으므로 일반 수정 작업으로는 값이 리셋되지 않음.
2. **기존 데이터 백필**: `scripts/set-baptism.sh`를 인자 없이 1회 실행해, 필드가 없던 기존 연결자 118건 전체에 `baptism:0`을 채워넣음(RTDB에 직접 REST PATCH — 코드 배포와 무관한 1회성 데이터 마이그레이션).
3. **Mariana(메인 인도자 Joy) `baptism:1` 설정**: `scripts/set-baptism.sh`로 해당 연결자 1건만 값을 1로 변경.
4. **`baptized` 카드 시각 강조 추가**: 애초엔 "UI에 전혀 노출 안 함"으로 설계했으나, 이후 요청으로 `baptism===1`인 카드를 연결자/약속/유효 3개 탭 전부에서 골드 테두리+뱃지+애니메이션으로 강조하도록 변경(6번 공용 유틸 참고, `baptizedClass`/`baptizedBadge`). 기존 팔레트의 브론즈/골드 톤(`--tab-2`, "soon" 뱃지 색)을 확장해 톤을 맞춤. 모바일 뷰포트(390px)에서 Playwright로 실제 렌더링 확인 완료 — 콘솔 에러 없음, 임박도 뱃지와 위치 겹침 없음.

### 2026-09-30

- `index.html`의 CSS/JS를 기능별 파일로 분리하고, 인라인 이벤트를 `data-action` 이벤트 위임으로 교체.
- 연결자 카드/필드 및 검색 로직을 공용화하고, 캘린더 날짜를 키보드 접근 가능한 버튼으로 변경.
- 로그인 전환 시 구독을 해제·재등록하고 저장 실패 시 입력창이 유지되도록 오류 처리.
- 유효 회차와 연결자 연쇄 삭제는 한 번의 다중 경로 갱신으로 처리.
- 모의 Firebase 기반 테스트와 로컬 브라우저 렌더링으로 확인.
- `UX_AUDIT.md`의 P0~P2 문제를 조치했다. 날짜 상세 편집 스택·이탈 확인·전체 유효 삭제 차단·필수 날짜 검증·저장 상태 표시·요약 카드·필터/정렬/페이지 단위 표시·모바일 달력 접기·필드 오류와 모달 접근성을 적용했다. 실제 Firebase 데이터는 수정하지 않고 가상 데이터 미리보기로 화면을 확인했다.
- 이후 DB 다운로드량을 줄이기 위해 15건 조회·스크롤 추가 로딩과 조회 인덱스 이전 코드를 추가했다. 2026-09-30에 조회 인덱스 규칙을 게시하고 226건의 연결자·130건의 약속·62건의 유효 기록을 백필한 뒤 `paginationVersion=1`을 설정했다. 기존에 열린 세션은 새로고침해야 페이지 조회로 전환된다.
- 실서비스에서 연결자 15→30건, 전체 연결자 첫 15건, 유효 15→30명을 확인했다. 지난 약속 조회에서 Firebase가 빈 문자열 경계 키를 거부한 오류를 발견해, 직전 1분을 상한으로 쓰도록 수정했다.
- GitHub Pages의 JS 캐시가 이전 `paging.js`를 유지하므로 `index.html`의 스크립트 URL에 버전 쿼리를 붙여 수정본을 새로 받도록 했다.
