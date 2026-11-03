import type { ComposeSelectorSet } from '../../naverworks/types';
import { GMAIL_HOST } from '../../../core/model/mail-provider';

const emptyRecipient = { input: '', chip: '', chipEmail: '', commit: [] as Array<'enter' | 'semicolon' | 'comma' | 'blur' | 'tab'> };

/** Gmail 작성 창 하나(제목칸을 품은 영역). 받은편지함에서 창이 여러 개면 제목칸 값으로 고른다. */
const SCOPE = 'div[role="region"]:has(input[name="subjectbox"])';

/**
 * Gmail 셀렉터셋. Gmail 표시 언어 한국어 전제(aria-label 한글 의존, 영어 UI는 3차).
 * 근거 실측: docs/probe/bidmate-probe-mail.google.com-20261103-{210450,212816,213623,213833,213836}.json
 * 받는 사람, 참조는 주소로 넣고 칩 대조는 보류(칩 안 주소 표기 미실측, 결과 partial).
 * 수동 검증(docs/gmail-verification.md) 전까지 unverified.
 */
export const gmailV1: ComposeSelectorSet = {
  id: 'gmail-v1',
  version: '0.9.0-unverified',
  status: 'unverified',
  hostPattern: GMAIL_HOST,
  compose: { readySelector: SCOPE, scope: SCOPE },
  to: { ...emptyRecipient },
  cc: { ...emptyRecipient },
  subject: { input: 'input[name="subjectbox"]' },
  body: { kind: 'contenteditable', editable: 'div[aria-label="메일 본문"][contenteditable="true"][role="textbox"]', insert: [] },
  attach: {
    fileInput: 'input[type="file"][name="Filedata"]',
    item: '.dL',
    itemName: '.vI',
    itemSize: '.vJ',
    // 업로드 중에는 .vI가 없어서 항목 설명(aria-label)의 이름으로 찾는다
    itemLabelAttr: 'aria-label',
    itemProgress: '[role="progressbar"]',
    // 완료 상태에만 생기는 숨은 입력
    itemDone: 'input[type="hidden"][name="attach"]',
    // 받은편지함 작성 창 자체가 dialog라 작성 영역을 품은 것과 숨은 것은 뺀다
    blockingDialog: '[role="dialog"]:not([aria-hidden="true"]):not(:has(div[role="region"]))',
    // 합계 25MB를 넘기면 Gmail이 Drive 업로드 뒤 본문에 링크 칩을 넣는다
    convertedMarker: 'div.gmail_chip.gmail_drive_chip',
    // 단위(25,000,000 / 26,214,400) 미확정이라 작은 쪽
    limits: { perFileBytes: 25_000_000, totalBytes: 25_000_000 },
    methods: ['input'],
  },
  forbidden: { send: ['div[role="button"][aria-label^="보내기"]'], textPatterns: ['보내기', '전송', 'Send', '발송'] },
  sendWatch: { buttons: ['[aria-label^="보내기"]', '[data-tooltip^="보내기"]'], textPatterns: ['보내기'], hotkey: true },
};
