# 디자인 개편: 면과 깊이

## 목표
무채색 계열은 유지하고, 바탕(canvas)을 한 단 낮추고 카드와 사이드바(surface)를 띄워 입체감을 준다. 대상은 대시보드, 팝업, 사이드패널. `src/ui/g2b-panel/*`은 범위 밖(건드리지 않는다).

## 공통 규칙 (모든 단위)
- 가운뎃점 문자(·) 사용 금지(주석 포함).
- `--shadow-*`를 다크 블록에서 덮어쓰지 않는다(Tailwind v4가 빌드 시 인라인). 다크 전환은 `--color-shade-*`로만.
- 그림자는 `shadow-card`, `shadow-raised`, `shadow-overlay`, `shadow-btn`, `inset-shadow-sunken` 유틸리티로만. `@utility`, `style={{boxShadow}}` 금지(focus ring과 충돌).
- `bg-sunken`은 surface(카드, 사이드바) 안에서만. canvas 위에 직접 쓰지 않는다.
- `hover:bg-canvas`는 전부 `hover:bg-sunken`으로.
- 카드 안 상자는 `rounded-ctl`(카드 자체만 `rounded-card`).
- `shadow-raised`는 hover한 클릭 카드와 토스트만, `shadow-overlay`는 서랍만.
- 손대지 않는 것: `src/ui/components/Logo.tsx`, `src/entrypoints/dashboard/home/MonthlyBars.tsx`(이미 개편됨), 대시보드 좌측 메뉴 글자/아이콘 크기(App.tsx의 nav 부분), 색 계열.
- 각 단위는 지정 파일만 수정한다. 범위 밖 수정이 필요하면 중단하고 보고.

## U1 토큰 + 공통 컴포넌트 (선행)
대상: `src/ui/theme/theme.css`, `src/ui/components/{Card,Button,Field,InlineAlert,Toast}.tsx`

theme.css `@theme`:
- `--color-canvas: #ebebe7`, `--color-muted: #65655f`, `--radius-card: 10px`
- 추가:
```css
/* 그림자 색. shadow 값은 빌드 시 인라인되므로 색만 변수로 빼서 다크에서 덮어쓴다. */
--color-shade-1: rgb(27 27 25 / 0.06);
--color-shade-2: rgb(27 27 25 / 0.09);
--color-shade-3: rgb(27 27 25 / 0.18);
/* 1단: 놓인 카드 */
--shadow-card: 0 1px 2px var(--color-shade-1), 0 2px 8px -2px var(--color-shade-2);
/* 2단: 들린 요소(hover한 클릭 카드, 토스트) */
--shadow-raised: 0 2px 6px var(--color-shade-1), 0 10px 24px -6px var(--color-shade-3);
/* 3단: 오버레이(서랍) */
--shadow-overlay: 0 8px 24px var(--color-shade-2), 0 32px 72px -12px var(--color-shade-3);
/* 보조 버튼 바닥선 */
--shadow-btn: 0 1px 2px var(--color-shade-1);
/* 패인 면, 입력창 안쪽 */
--inset-shadow-sunken: inset 0 1px 2px var(--color-shade-1);
```
theme.css 다크 블록: `--color-canvas: #111110`, `--color-sunken: #171716`, `--color-line: #2e2e2b`, 그리고
`--color-shade-1: rgb(0 0 0 / 0.45); --color-shade-2: rgb(0 0 0 / 0.35); --color-shade-3: rgb(0 0 0 / 0.6);`

Card.tsx:
- `section`에 `shadow-card` 추가.
- header: children(본문) 있을 때 `pb-4 border-b border-line` 추가, 없을 때는 header 자체를 `py-5`로 하고 현재의 빈 `div.pb-5` 제거.
- 본문 래퍼: `space-y-4 px-6 pt-4 pb-6` → `space-y-4 px-6 py-5`.
- `CardProps` 인터페이스 변경 없음. description의 `pl-[11.5px]` 유지.

Button.tsx: `secondary`에 `shadow-btn disabled:shadow-none` 추가. primary, ghost 변경 없음.
Field.tsx: `inputClass`에 `inset-shadow-sunken` 추가.
InlineAlert.tsx: tone별 클래스에 테두리 추가. info `border border-accent/20`, ok `border border-ok/20`, warn `border border-warn/20`, error `border border-danger/20`.
Toast.tsx: 토스트 상자에 `shadow-raised` 추가.

완료 조건: 빌드 산출 CSS의 `.shadow-card` 규칙에 `var(--color-shade-1)` 문자열 포함, 다크 블록에 `--color-shade-1` 재정의 존재, 타입체크 통과.

## U2 대시보드 뼈대 + 홈
대상: `src/entrypoints/dashboard/App.tsx`, `HomePage.tsx`, `home/StatCard.tsx`
- App.tsx `aside`: `border-r border-line` 뒤에 `bg-surface` 추가. nav 부분은 수정 금지.
- HomePage.tsx: `hover:bg-canvas` → `hover:bg-sunken`.
- StatCard.tsx 링크 클래스: `block rounded-card border border-line bg-surface px-5 py-4 shadow-card transition-[box-shadow,border-color] hover:border-line-strong hover:shadow-raised motion-reduce:transition-none`. translate 애니메이션 금지.

## U3 공고 + 검수
대상: `src/entrypoints/dashboard/NoticesPage.tsx`, `ReviewPage.tsx`, `review/ItemCard.tsx`, `review/TextDrawer.tsx`
- NoticesPage: 표 래퍼(`overflow-hidden rounded-card border border-line bg-surface`)에 `shadow-card` 추가. 행 `hover:bg-canvas` → `hover:bg-sunken`.
- ReviewPage: Collapsible `section`에 `shadow-card`, 그 버튼 `hover:bg-canvas` → `hover:bg-sunken`, 카드 목록 컨테이너(rounded-card border bg-surface)에 `shadow-card`. canvas 위의 집계 줄(`border-y border-line`)은 유지.
- ItemCard Editor 상자: `space-y-3 rounded-card border border-line bg-canvas p-4` → `space-y-3 rounded-ctl border border-line bg-sunken inset-shadow-sunken p-4`.
- TextDrawer: `shadow-2xl` → `shadow-overlay`, `hover:bg-canvas` → `hover:bg-sunken`. 배경막 `bg-black/30` 유지.

## U4 설정, 진단, 템플릿, 수신자, 메일 준비
대상: `src/entrypoints/dashboard/StorageFolderCard.tsx`, `CollectTestSection.tsx`, `templates/SectionEditor.tsx`, `templates/MailPreviewFrame.tsx`, `recipients/RecipientTable.tsx`
- StorageFolderCard 폴더 박스: `rounded-card border border-line bg-canvas px-4 py-3` → `rounded-ctl border border-line bg-sunken inset-shadow-sunken px-4 py-3`.
- CollectTestSection JobView: `rounded-card border border-line bg-canvas p-5` → `rounded-ctl border border-line bg-sunken inset-shadow-sunken p-5`.
- SectionEditor 안쪽 상자: `rounded-card border border-line bg-surface p-4` → `rounded-ctl border border-line bg-sunken p-4`.
- MailPreviewFrame 액자: `shadow-card` 추가.
- RecipientTable 안쪽 표 래퍼: `rounded-card` → `rounded-ctl`.

## U5 팝업 + 사이드패널
대상: `src/entrypoints/popup/App.tsx`, `src/entrypoints/sidepanel/App.tsx`, `src/entrypoints/sidepanel/DiagnosticsSection.tsx`
- popup 최상위: `w-[380px] space-y-5 bg-canvas p-6` → `w-[380px] space-y-4 bg-canvas p-5`. 나라장터 카드(rounded-card border bg-surface)에 `shadow-card`.
- sidepanel App: 바깥 `min-h-screen bg-canvas text-base` 유지. header → `sticky top-0 z-10 flex items-center gap-2.5 border-b border-line bg-surface px-5 py-3.5 shadow-card`. header 아래 섹션들(Section들과 DiagnosticsSection)을 `div.space-y-3.p-4`로 감싼다.
- sidepanel `Section` 컴포넌트: `space-y-3 border-t border-line px-5 py-5 first:border-t-0` → `space-y-3 rounded-card border border-line bg-surface p-4 shadow-card`. 제목 h2 `text-muted` → `text-ink`.
- DiagnosticsSection 최상위: `border-t border-line px-5 py-4` → `rounded-card border border-line bg-surface p-4 shadow-card`. 토글 버튼 유지.

## 순서
U1 → 빌드 확인 → U2~U5 병렬 → 전체 빌드, 타입체크, 잔존 grep(`src/entrypoints`에 `hover:bg-canvas` 0건, `shadow-2xl` 0건, `bg-canvas`는 dashboard App, popup, sidepanel 최상위 3곳만).

## 보고 형식
변경 파일:줄 범위, 명세와 다르게 한 부분과 이유, 실패 항목. 한국어, 결론 위주.
