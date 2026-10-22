import { Plus, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { normalizeBizNo } from '../../core/evaluation/company';
import { ATTRIBUTE_PRESETS, CREDIT_KIND_LABEL } from '../../core/types/company';
import type { CreditGrade, CreditKind } from '../../core/types/settings';
import { Button, Card, Field, FormActions, InlineAlert, useToast } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';
import { useSettings } from '../../ui/hooks/useSettings';

const CREDIT_KINDS = Object.keys(CREDIT_KIND_LABEL) as CreditKind[];
const MAX_ATTRIBUTES = 30;
type CreditDraft = Record<CreditKind, { grade: string; evaluatedAt: string; agency: string }>;
const emptyCredit = (): CreditDraft => ({
  corporate: { grade: '', evaluatedAt: '', agency: '' },
  bond: { grade: '', evaluatedAt: '', agency: '' },
  cp: { grade: '', evaluatedAt: '', agency: '' },
});
const chipClass = (on: boolean) =>
  `inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none ${on ? 'border-primary bg-sunken font-semibold text-ink' : 'border-line-strong bg-btn-face text-muted hover:bg-surface'}`;

export function CompanyCard() {
  const { settings, save } = useSettings();
  const [bizNo, setBizNo] = useState('');
  const [name, setName] = useState('');
  const [credit, setCredit] = useState<CreditDraft>(emptyCredit);
  const [attrs, setAttrs] = useState<string[]>([]);
  const [attrInput, setAttrInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const savedBiz = settings?.company.bizNo;
  const savedName = settings?.company.name;
  useEffect(() => { if (savedBiz !== undefined) setBizNo(savedBiz); }, [savedBiz]);
  useEffect(() => { setName(savedName ?? ''); }, [savedName]);

  const savedCredit = settings?.company.credit;
  const savedAttrs = settings?.company.attributes;
  useEffect(() => {
    const d = emptyCredit();
    for (const k of CREDIT_KINDS) {
      const c = savedCredit?.[k];
      if (c) d[k] = { grade: c.grade, evaluatedAt: c.evaluatedAt ?? '', agency: c.agency ?? '' };
    }
    setCredit(d);
  }, [savedCredit]);
  useEffect(() => { setAttrs(savedAttrs ?? []); }, [savedAttrs]);

  const setCreditField = (k: CreditKind, f: 'grade' | 'evaluatedAt' | 'agency', v: string) =>
    setCredit((c) => ({ ...c, [k]: { ...c[k], [f]: v } }));
  const toggleAttr = (a: string) => setAttrs((l) => (l.includes(a) ? l.filter((x) => x !== a) : [...l, a]));
  const addAttr = () => {
    const v = attrInput.trim();
    if (!v) return;
    if (v.length > 40) { setError('가점 항목은 40자 이내로 적어 주세요.'); return; }
    if (!attrs.includes(v) && attrs.length >= MAX_ATTRIBUTES) { setError(`가점 항목은 최대 ${MAX_ATTRIBUTES}개까지 추가할 수 있습니다.`); return; }
    setError(null);
    setAttrs((l) => (l.includes(v) ? l : [...l, v]));
    setAttrInput('');
  };

  const submit = async () => {
    if (!settings) return;
    setError(null);
    const digits = normalizeBizNo(bizNo);
    if (digits !== '' && digits.length !== 10) { setError('사업자등록번호는 숫자 10자리여야 합니다. 예: 123-45-67890'); return; }
    const nextCredit: Partial<Record<CreditKind, CreditGrade>> = {};
    for (const k of CREDIT_KINDS) {
      const grade = credit[k].grade.trim();
      const evaluatedAt = credit[k].evaluatedAt.trim();
      const agency = credit[k].agency.trim();
      if (!grade && !evaluatedAt && !agency) continue;
      const label = CREDIT_KIND_LABEL[k];
      if (!grade) { setError(`${label}: 평가일이나 평가기관만 적을 수 없습니다. 등급을 입력하세요.`); return; }
      if (grade.length > 10) { setError(`${label}: 등급은 10자 이내로 적어 주세요.`); return; }
      if (agency.length > 30) { setError(`${label}: 평가기관은 30자 이내로 적어 주세요.`); return; }
      nextCredit[k] = { grade, ...(evaluatedAt ? { evaluatedAt } : {}), ...(agency ? { agency } : {}) };
    }
    const nextAttrs = [...new Set(attrs.map((a) => a.trim()).filter(Boolean))];
    if (nextAttrs.some((a) => a.length > 40)) { setError('가점 항목은 40자 이내로 적어 주세요.'); return; }
    if (nextAttrs.length > MAX_ATTRIBUTES) { setError(`가점 항목은 최대 ${MAX_ATTRIBUTES}개까지 저장할 수 있습니다.`); return; }
    setBusy(true);
    try {
      const n = name.trim();
      await save({
        ...settings,
        company: {
          bizNo: digits,
          ...(n ? { name: n } : {}),
          ...(Object.keys(nextCredit).length ? { credit: nextCredit } : {}),
          ...(nextAttrs.length ? { attributes: nextAttrs } : {}),
        },
      });
      setBizNo(digits);
      toast.saved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="우리 회사" description="평가 점수 분석의 우리 회사 기준과, 공고 상세의 예상 정량 점수 참고 정보에 씁니다.">
      <Field label="사업자등록번호" htmlFor="company-biz" help="하이픈은 있어도 됩니다. 저장하면 숫자 10자리로 정리됩니다.">
        <input id="company-biz" className={inputClass} value={bizNo} onChange={(e) => setBizNo(e.target.value)} placeholder="123-45-67890" />
      </Field>
      <Field label="회사명 (선택)" htmlFor="company-name">
        <input id="company-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="mt-4 grid gap-3 border-t border-line pt-4">
        <h3 className="text-sm font-semibold text-ink">신용평가등급</h3>
        {CREDIT_KINDS.map((k) => (
          <div key={k} className="grid gap-2 sm:grid-cols-3">
            <Field label={CREDIT_KIND_LABEL[k]} htmlFor={`company-credit-${k}`}>
              <input id={`company-credit-${k}`} className={inputClass} value={credit[k].grade} onChange={(e) => setCreditField(k, 'grade', e.target.value)} placeholder="BBB+" />
            </Field>
            <Field label="평가일 (선택)" htmlFor={`company-credit-${k}-date`}>
              <input id={`company-credit-${k}-date`} type="date" className={inputClass} value={credit[k].evaluatedAt} onChange={(e) => setCreditField(k, 'evaluatedAt', e.target.value)} />
            </Field>
            <Field label="평가기관 (선택)" htmlFor={`company-credit-${k}-agency`}>
              <input id={`company-credit-${k}-agency`} className={inputClass} value={credit[k].agency} onChange={(e) => setCreditField(k, 'agency', e.target.value)} />
            </Field>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 border-t border-line pt-4">
        <h3 className="text-sm font-semibold text-ink">신인도 가점 해당 항목</h3>
        <div className="flex flex-wrap gap-2">
          {ATTRIBUTE_PRESETS.map((a) => (
            <button key={a} type="button" aria-pressed={attrs.includes(a)} className={chipClass(attrs.includes(a))} onClick={() => toggleAttr(a)}>{a}</button>
          ))}
          {attrs.filter((a) => !(ATTRIBUTE_PRESETS as readonly string[]).includes(a)).map((a) => (
            <button key={a} type="button" aria-pressed title="누르면 해제" className={chipClass(true)} onClick={() => toggleAttr(a)}>{a}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            aria-label="가점 항목 직접 추가"
            className={inputClass}
            value={attrInput}
            onChange={(e) => setAttrInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addAttr(); } }}
            placeholder="목록에 없는 항목 직접 추가"
          />
          <Button variant="secondary" icon={<Plus />} onClick={addAttr}>추가</Button>
        </div>
      </div>
      <FormActions>
        <Button icon={<Save />} loading={busy} disabled={!settings} onClick={() => void submit()}>저장</Button>
      </FormActions>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {toast.node}
    </Card>
  );
}
