import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Select, inputClass, type SelectOption } from '../../../ui/components';

/** chrome.storage.local 키. 사용자가 추가한 메일 도메인 목록(맨 앞이 기본 선택). */
const STORAGE_KEY = 'emailDomains';
const DEFAULT_MY_DOMAINS = ['xcs.co.kr'];
const COMMON_DOMAINS = ['naver.com', 'gmail.com', 'daum.net', 'hanmail.net', 'kakao.com', 'nate.com', 'outlook.com'];
/** 셀렉트에서 '직접 입력'을 뜻하는 값. 도메인에는 '@'가 올 수 없어 겹치지 않는다. */
const CUSTOM = '@custom';

const normDomain = (d: string) => d.trim().toLowerCase().replace(/^@+/, '');
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

async function loadMyDomains(): Promise<string[]> {
  try {
    const got = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    return Array.isArray(got) ? got.filter((d): d is string => typeof d === 'string') : DEFAULT_MY_DOMAINS;
  } catch { return DEFAULT_MY_DOMAINS; }
}
async function saveMyDomains(list: string[]) {
  await chrome.storage.local.set({ [STORAGE_KEY]: list });
}

interface Props {
  id: string;
  value: string;
  onChange: (email: string) => void;
}

/** 이메일 = 아이디 칸 + @ + 도메인 셀렉트. '직접 입력'으로 쓴 도메인은 '내 도메인'에 저장해 다음에 고를 수 있다. */
export function EmailDomainInput({ id, value, onChange }: Props) {
  const at = value.lastIndexOf('@');
  const local = at >= 0 ? value.slice(0, at) : value;
  const initDomain = at >= 0 ? value.slice(at + 1) : '';

  const [myDomains, setMyDomains] = useState<string[]>(DEFAULT_MY_DOMAINS);
  // 기존 주소의 도메인이 목록에 없으면 '직접 입력'으로 연다. 첫 렌더에서 고정해 목록 로딩 뒤에도 바뀌지 않게 한다.
  const [choice, setChoice] = useState<string>(() => initDomain || DEFAULT_MY_DOMAINS[0]!);
  const [customDomain, setCustomDomain] = useState('');

  useEffect(() => {
    let alive = true;
    void loadMyDomains().then((list) => {
      if (!alive) return;
      setMyDomains(list);
      // 새 주소면 '내 도메인' 맨 앞을 기본으로 고른다.
      if (!initDomain && list[0]) setChoice(list[0]);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const known = new Set([...myDomains, ...COMMON_DOMAINS]);
  const isCustom = choice === CUSTOM || !known.has(choice);
  const domain = isCustom ? (choice === CUSTOM ? customDomain : choice) : choice;

  // 화면 상태가 바뀌면 합친 주소를 부모로 올린다.
  // 아이디가 비어 있으면 빈 값으로 둔다(도메인만 있는 주소를 만들지 않음).
  const emit = (l: string, d: string) => onChange(l ? `${l}@${d}` : '');
  useEffect(() => { emit(local, normDomain(domain)); }, [domain]); // eslint-disable-line react-hooks/exhaustive-deps

  const options: SelectOption[] = [
    ...myDomains.map((d) => ({ value: d, label: d, group: '내 도메인' })),
    ...COMMON_DOMAINS.filter((d) => !myDomains.includes(d)).map((d) => ({ value: d, label: d, group: '자주 쓰는 도메인' })),
    { value: CUSTOM, label: '직접 입력' },
  ];

  const onLocal = (v: string) => {
    // 전체 주소를 붙여 넣으면 아이디와 도메인을 나눈다.
    const i = v.lastIndexOf('@');
    if (i < 0) return emit(v, normDomain(domain));
    const d = normDomain(v.slice(i + 1));
    if (known.has(d)) setChoice(d); else { setChoice(CUSTOM); setCustomDomain(d); }
    emit(v.slice(0, i), d);
  };
  const onPick = (v: string) => {
    if (v === CUSTOM) setCustomDomain(isCustom ? domain : '');
    setChoice(v);
  };

  const nd = normDomain(customDomain);
  const canSave = choice === CUSTOM && DOMAIN_RE.test(nd) && !myDomains.includes(nd);
  const addDomain = async () => {
    const next = [...myDomains, nd];
    setMyDomains(next);
    setChoice(nd);
    await saveMyDomains(next);
  };
  const removeDomain = async (d: string) => {
    const next = myDomains.filter((x) => x !== d);
    setMyDomains(next);
    setCustomDomain(d);
    setChoice(CUSTOM);
    await saveMyDomains(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input id={id} className={`${inputClass} min-w-0 flex-1`} value={local} placeholder="아이디" autoComplete="off" onChange={(e) => onLocal(e.target.value)} />
        <span aria-hidden className="text-muted">@</span>
        <Select className="min-w-0 flex-1" aria-label="메일 도메인" value={isCustom ? CUSTOM : choice} options={options} onChange={onPick} searchable={false} />
      </div>
      {isCustom && (
        <div className="flex items-center gap-2">
          <input aria-label="도메인 직접 입력" className={`${inputClass} min-w-0 flex-1`} placeholder="example.co.kr" value={choice === CUSTOM ? customDomain : choice}
            onChange={(e) => { setChoice(CUSTOM); setCustomDomain(e.target.value); }} />
          <button type="button" disabled={!canSave} onClick={() => void addDomain()}
            className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-accent disabled:cursor-not-allowed disabled:text-faint [&_svg]:size-3.5">
            <Plus aria-hidden />내 도메인에 추가
          </button>
        </div>
      )}
      {!isCustom && myDomains.includes(choice) && (
        <button type="button" onClick={() => void removeDomain(choice)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-danger [&_svg]:size-3">
          <X aria-hidden />{choice}을(를) 내 도메인에서 빼기
        </button>
      )}
    </div>
  );
}
