import type { ComposeSelectorSet } from '../types';

const emptyRecipient = { input: '', chip: '', chipEmail: '', commit: [] as Array<'enter' | 'semicolon' | 'comma' | 'blur' | 'tab'> };

/**
 * 실측(2026-10-19, docs/probe/bidmate-probe-mail.worksmobile.com-20261019-170832.json + 콘솔 확인).
 * 작성 화면: /write/popup. 받는 사람, 참조, 제목은 주소 파라미터로 채운다(compose-url.ts), 그래서 수신자 셀렉터는 비워 둔다.
 * 본문: 주소 없는 iframe 안의 workseditor. 서명 블록은 남기고 그 앞에 넣는다.
 * 첨부: 파일 선택 칸(#fileContent, 바깥 문서)에 넣으면 본문 iframe 안 첨부 목록(li.attachment_item)에 나타난다.
 *   상태는 보낼 때까지 '대기 중'이고 보내기 시점에 올라간다(사용자 확인). 그래서 목록에 나타나면 첨부된 것으로 본다.
 *   이름은 .file_name + .file_extension으로 나뉘어 있어 .file_name_cover 전체로 대조한다.
 */
export const naverworksV1: ComposeSelectorSet = {
  id: 'naverworks-v1',
  version: '1.1.0',
  status: 'verified',
  hostPattern: 'mail.worksmobile.com',
  compose: { readySelector: '#cont_flex_area input[name="subject"]' },
  to: { ...emptyRecipient },
  cc: { ...emptyRecipient },
  subject: { input: '#cont_flex_area input[name="subject"]' },
  body: {
    kind: 'iframe',
    iframe: '#cont_flex_area iframe',
    editable: '.workseditor-content[contenteditable="true"]',
    insert: ['execCommand', 'paste', 'innerHTML'],
    keep: '[data-workseditor="sign-content"]',
  },
  attach: {
    inBodyFrame: true,
    fileInput: '#fileContent',
    item: 'li.attachment_item',
    itemName: '.file_name_cover',
    itemSize: '.file_size',
    methods: ['input'],
  },
  forbidden: { send: ['[data-hotkey="sendKey"]'], textPatterns: ['보내기', '전송', 'Send', '발송'] },
  sendWatch: { buttons: ['button[data-hotkey="sendKey"]'], textPatterns: ['보내기'], hotkey: true, gone: '#cont_flex_area input[name="subject"]' },
  // 주소 목록은 2026-10-21 콘솔 실측: 칸마다 .list_addrobj(li 칩 + li.new_addr 입력), 화면 순서 받는사람·참조·숨은참조.
  // 칩 주소는 div.addr_obj_wrap > div.addr_obj > span(이름이 붙으면 '이름 <주소>'). 세 칸 순서는 사용자 실측으로 확인.
  autoSend: { button: 'button.lw_btn_point[data-hotkey="sendKey"]', recipientLists: { list: '.list_addrobj', chip: 'div.addr_obj_wrap > div.addr_obj > span' } },
};
