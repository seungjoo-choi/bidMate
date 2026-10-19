# 마스코트 공통 부품과 화면 적용

## 목표
BidMate 마스코트(로봇 캐릭터 PNG)를 여러 화면에서 같은 자산, 같은 움직임 정의로 쓰도록 공통 모듈 `src/ui/mascot/`을 만들고, 웹메일 진행 카드와 대시보드 쪽 화면에 적용한다. 표정별 그림은 아직 한 장뿐이고, 나중에 파일 추가와 맵 한 줄로 바뀌게 한다.

## 이미 끝난 것 (U0, 메인)
- `public/icon/mascot/full.png`(전신 256px), `public/icon/mascot/face.png`(얼굴 크롭 256px)
- 툴바 아이콘 `public/icon/{16,32,48,96,128}.png`를 얼굴 크롭으로 교체
- 원본은 `design/mascot-source.png`(배포 제외). `public/icon/bidmate-96.png`는 다른 세션(사이드패널)이 쓰는 중이라 유지
- 웹메일 진행 카드 `src/ui/trackerbot/progress-card.ts`에는 이미 마스코트가 들어가 있다(지금은 `./assets/bidmate-mascot.png?inline` data URI + 카드 STYLE 안의 keyframes). U2에서 공통 모듈로 옮긴다

## 공통 제약
- 같은 작업 트리에서 다른 세션이 미커밋으로 여러 파일을 수정 중이다. **수정 금지 파일**: `src/entrypoints/sidepanel/*`, `src/ui/g2b-panel/*`, `src/background/*`, `src/ui/trackerbot/{controller,row-button,row-view,progress-view}.ts`, `.claude/specs/decisions.md`. 대상 파일도 전체 재작성이나 포맷 변경 없이 필요한 부분만 고친다.
- 마스코트 이미지는 장식이다. alt는 빈 문자열, aria-hidden. 사용자 데이터(공고명 등)를 alt, title에 넣지 않는다.
- 이미지 URL은 호출 시점에 `chrome.runtime.getURL`로 만든다(try/catch, 실패하면 `/icon/mascot/<파일>`). 모듈 최상위 상수로 두지 않는다(확장 업데이트 뒤 남은 content script에서 getURL이 throw).
- 움직임은 `prefers-reduced-motion: reduce`에서 모두 멈춘다. 갸웃(huh)만 기울어진 정지 자세를 유지한다.
- 저장 데이터, 스키마, 메시지 프로토콜 변경 없음.
- 코드 주석, 화면 문구에 가운뎃점(·) 기호를 쓰지 않는다. 나열은 쉼표, 짝은 슬래시.

## U1 공통 모듈 (신규 파일 + wxt.config.ts)
### `src/ui/mascot/assets.ts` (DOM, React 의존 없음)
```ts
export type MascotMood = 'idle' | 'guide' | 'work' | 'run' | 'happy' | 'huh';
export type MascotVariant = 'full' | 'face';
// 기분별 전용 그림. 없으면 BASE. 그림이 들어오면 여기 한 줄만 추가
const FILES: Record<MascotVariant, Partial<Record<MascotMood, string>>> = { full: {}, face: {} };
const BASE: Record<MascotVariant, string> = { full: 'full.png', face: 'face.png' };
export function mascotFile(mood: MascotMood, variant: MascotVariant): string; // FILES[variant][mood] ?? BASE[variant]
export function mascotSrc(mood: MascotMood = 'idle', variant: MascotVariant = 'full'): string; // 위 공통 제약의 getURL 규칙
export const MASCOT_CSS: string;
```
`MASCOT_CSS` 내용:
- `.bm-mascot { display: block; object-fit: contain; transform-origin: 50% 95%; user-select: none; -webkit-user-drag: none; }` 크기는 호출처가 width/height로 지정
- 기분별 애니메이션(`.bm-mascot[data-mood="..."]`):
  - idle: 없음
  - guide: bm-bob 2.4s ease-in-out infinite (`0%,100% translateY(0)`, `50% translateY(-4px)`)
  - work: bm-sway 2.2s ease-in-out infinite (`0%,100% rotate(-3deg)`, `50% rotate(3deg) translateY(-1px)`)
  - run: bm-run 380ms ease-in-out infinite (`0%,100% translateY(0) rotate(-6deg)`, `50% translateY(-3px) rotate(5deg)`)
  - happy: bm-hop 700ms cubic-bezier(.3,.7,.4,1), 반복 횟수 `var(--bm-hops, 1)`
  - huh: bm-shake 560ms ease-in-out 1 forwards + `filter: saturate(.6)`
  - bm-hop, bm-shake keyframes는 현재 `src/ui/trackerbot/progress-card.ts` STYLE의 같은 이름 keyframes를 그대로 옮긴다
- `@media (prefers-reduced-motion: reduce) { .bm-mascot { animation: none !important; } .bm-mascot[data-mood="huh"] { transform: rotate(-13deg); } }`
- 색을 쓰지 않는다

### `src/ui/mascot/dom.ts` (순수 DOM)
```ts
export function ensureMascotStyle(root: Document | ShadowRoot): void; // root 안에 style[data-bidmate-mascot]가 없을 때만 MASCOT_CSS를 추가. Document면 head에
export function createMascotImg(doc: Document, o: { mood?: MascotMood; variant?: MascotVariant; size: number }): HTMLImageElement;
// class 'bm-mascot', data-mood, data-variant, width/height 속성, alt '', draggable=false, aria-hidden='true', error 이벤트에서 hidden=true
export function setMascotMood(img: HTMLImageElement, mood: MascotMood): void; // data-mood 갱신, mascotFile이 달라지면 src 교체
```

### `src/ui/mascot/Mascot.tsx` (React)
```tsx
export function Mascot(props: { mood?: MascotMood; variant?: MascotVariant; size?: number; hops?: number; className?: string; style?: CSSProperties }): JSX.Element;
// <img className={`bm-mascot ${className}`} data-mood data-variant width height src={mascotSrc(mood, variant)} alt="" aria-hidden draggable={false} />
// useLayoutEffect에서 ensureMascotStyle(ref.current.getRootNode() as Document | ShadowRoot). hops가 있으면 style['--bm-hops']
// 기본값 mood 'idle', variant 'full', size 48
export function MascotSay(props: { mood: MascotMood; size?: number; children: ReactNode; className?: string }): JSX.Element;
// 마스코트 + 오른쪽 말풍선. 말풍선은 Tailwind 테마 토큰(bg-info-wash, border, border-accent/20, text-ink, rounded-card, text-sm, px-3 py-2)과 왼쪽 꼬리. 확장 페이지 전용
```
`src/ui/mascot/index.ts`에서 위 공개 항목을 다시 export.

### `src/ui/mascot/step-icons.ts`
`src/ui/trackerbot/progress-card.ts`의 `stepSvg`, `STEP_ICON`과 STYLE 안 단계 아이콘 CSS(`/* 단계 아이콘 움직임 */`부터 `si-draw` keyframes까지)를 그대로 옮긴다.
```ts
export const STEP_ICON: Record<string, string>;
export const STEP_ICON_CSS: string; // reduced-motion에서 정지 규칙 포함
```

### `wxt.config.ts`
manifest에 `web_accessible_resources: [{ resources: ['icon/mascot/*'], matches: ['https://*/*'] }]` 추가(기존 manifest 항목과 병합). `icon/*` 전체를 넣지 않는다.

### 테스트 `tests/ui/mascot.test.ts` (jsdom)
- chrome이 없을 때 `mascotSrc()`가 `/icon/mascot/full.png`, `mascotSrc('idle','face')`가 `/icon/mascot/face.png`
- `chrome.runtime.getURL`을 스텁하면 그 결과를 쓴다
- `ensureMascotStyle`을 같은 Document에 두 번 불러도 style이 1개, ShadowRoot에도 1개
- `createMascotImg` 속성(class, data-mood, width, alt, aria-hidden)
- `setMascotMood`로 data-mood가 바뀐다

## U2 웹메일 진행 카드 전환 (U1 뒤)
대상: `src/ui/trackerbot/progress-card.ts`
- `?inline` import와 `mascot()` 지역 함수를 없애고 `createMascotImg(doc, { mood, size })`를 쓴다. shadow를 만든 직후 `ensureMascotStyle(shadow)`.
- STYLE에서 bm-sway, bm-hop, bm-shake, bm-run keyframes와 `.root[data-mood=...] .sitter img`, `.item.* .runner img`의 animation 규칙을 지운다. `.sitter`, `.sitter img`, `.runner`, `.runner img`의 크기와 위치 규칙은 남긴다. 말풍선 keyframes(bm-bubble)는 남긴다.
- `stepSvg`, `STEP_ICON`, 단계 아이콘 CSS는 `src/ui/mascot/step-icons.ts`에서 가져온다(STYLE에 `STEP_ICON_CSS`를 이어 붙임).
- 기분 연결: `updateMood`가 정하는 `root.dataset.mood`(busy/hop/sad/done, 말풍선 색 규칙이 씀)는 그대로 두고, 걸터앉은 마스코트 img에 `setMascotMood`로 busy→work, hop→happy(`--bm-hops: 2`), sad→huh, done→happy(1)를 준다. 막대 위 마스코트는 항목 표시 상태 active→run, arrive→happy(`--bm-hops: 2`), fail→huh.
- 기존 동작(노드 재사용, 전환 타이머, 진행률 차오름, 버튼) 변경 없음.
- `src/ui/trackerbot/assets/bidmate-mascot.png`와 빈 `assets` 폴더 삭제.
- 완료 조건: 기존 `tests/ui/trackerbot-progress-card.test.ts`, `tests/ui/trackerbot-progress-popup.test.ts` 전부 통과.

## U3 대시보드와 공통 컴포넌트 (U1 뒤, U2와 병렬 가능)
- `src/ui/components/EmptyState.tsx` 신설, `src/ui/components/index.ts`에서 export.
  `{ title: string; hint?: ReactNode; size?: 'lg' | 'sm'; children?: ReactNode; className?: string }`
  - lg: `src/entrypoints/dashboard/HomePage.tsx`의 빈 공고 블록(약 59~65줄)의 점선 상자 클래스 그대로 + `<Mascot mood="guide" size={88} />` + 제목(font-semibold text-ink) + hint(text-sm) + children
  - sm: `flex items-center justify-center gap-2.5 py-6 text-sm text-muted` + `<Mascot variant="face" size={28} />` + title + children
- 적용(문구는 그대로):
  - HomePage.tsx 빈 공고 블록 → lg. "7일 안에 마감되는 공고가 없습니다.", "최근 7일 안에 수집한 공고가 없습니다." → sm
  - NoticesPage.tsx "아직 수집한 공고가 없습니다"(약 80~86줄) → lg, "조건에 맞는 공고가 없습니다."(약 109줄) → sm(기존 래퍼 클래스 유지)
  - recipients/RecipientTable.tsx "아직 수신자가 없습니다."(약 39~46줄) → lg, 기존 버튼들은 children
  - recipients/GroupList.tsx "아직 그룹이 없습니다."(약 36줄) → sm, `className="justify-start px-3 py-1"`
- `src/ui/components/InlineAlert.tsx`: `leading?: ReactNode` prop 추가. 있으면 기본 아이콘 대신 그것을 그린다(`mt-[3px]` 없이). 다른 호출처 무변경.
- `src/entrypoints/dashboard/FsErrorAlert.tsx`의 warn, error InlineAlert 두 곳에 `leading={<Mascot mood="huh" size={40} />}`.
- `src/entrypoints/dashboard/GrantPage.tsx` "저장 폴더 접근" Card 안 맨 위에 `<MascotSay mood="guide" size={72}>공고 첨부파일을 정리해 둘 폴더를 열 수 있게 허락해 주세요.</MascotSay>`, 그 아래 `ul.list-disc.pl-5.text-sm.text-muted.space-y-1` 두 줄: "설정에서 고른 저장 폴더 하나만 엽니다" / "수집한 공고 파일을 그 폴더에 저장합니다". 버튼과 오류 처리 로직 무변경.
- `src/ui/components/Logo.tsx`: SVG를 지우고 `<img src={mascotSrc('idle', 'face')} width={size} height={size} alt="" aria-hidden draggable={false} className={`shrink-0 rounded-full ${className}`} />`. 이름과 props(size, className) 유지, 애니메이션 없음. 주석을 "마스코트 얼굴. 툴바 아이콘(public/icon/*.png)과 같은 크롭"으로.
- `src/ui/compose/ComposeCard.tsx` done 상태(약 220~230줄)의 완료 아이콘(CheckCircle2 등)을 `<Mascot mood="happy" size={40} />`로. 문구 유지.
- 완료 조건: `tsc --noEmit`에서 이 변경으로 생긴 에러 없음, 관련 테스트 통과.

## U4 미룸 (다른 세션 커밋 뒤, 메인이 별도 명세)
- 나라장터 패널 `src/ui/g2b-panel/Panel.tsx` 진행 막대 위 마스코트(run)와 단계 아이콘, 오류 카드 huh
- 사이드패널 `SummaryCard.tsx`의 `/icon/bidmate-96.png`를 Mascot으로, `public/icon/bidmate-96.png` 삭제

## 보고 형식
결론, 바꾼 파일과 줄 범위, 명세와 다르게 한 점과 이유, 실패 항목만 한국어로. 가운뎃점(·) 기호 금지.
