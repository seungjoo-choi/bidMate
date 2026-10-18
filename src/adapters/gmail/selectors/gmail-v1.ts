import type { ComposeSelectorSet } from '../../naverworks/types';
import { GMAIL_HOST } from '../../../core/model/mail-provider';

const emptyRecipient = { input: '', chip: '', chipEmail: '', commit: [] as Array<'enter' | 'semicolon' | 'comma' | 'blur' | 'tab'> };

/** 실측 전 셀렉터셋. 값을 추정해서 채우지 않는다. */
export const gmailV1: ComposeSelectorSet = {
  id: 'gmail-v1',
  version: '0.0.0-unverified',
  status: 'unverified',
  hostPattern: GMAIL_HOST,
  compose: { readySelector: '' },
  to: { ...emptyRecipient },
  cc: { ...emptyRecipient },
  subject: { input: '' },
  body: { kind: 'contenteditable', editable: '', insert: [] },
  attach: { item: '', itemName: '', methods: [] },
  forbidden: { send: [], textPatterns: ['보내기', '전송', 'Send', '발송'] },
};
