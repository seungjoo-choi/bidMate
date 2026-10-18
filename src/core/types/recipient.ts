import type { ISODate } from './common';

export interface Recipient { id: string; name: string; email: string; dept?: string; memo?: string; enabled: boolean; defaultRole: 'to' | 'cc'; updatedAt: ISODate; }
export interface Group { id: string; name: string; memberIds: string[]; roleOverrides?: Record<string, 'to' | 'cc'>; isDefault: boolean; updatedAt: ISODate; }
// 해석: enabled=false 제외 → 이메일 소문자 정규화 중복 제거 → TO가 CC보다 우선
