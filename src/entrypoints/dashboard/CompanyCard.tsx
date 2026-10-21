import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { normalizeBizNo } from '../../core/evaluation/company';
import { Button, Card, Field, FormActions, InlineAlert, useToast } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';
import { useSettings } from '../../ui/hooks/useSettings';

export function CompanyCard() {
  const { settings, save } = useSettings();
  const [bizNo, setBizNo] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const savedBiz = settings?.company.bizNo;
  const savedName = settings?.company.name;
  useEffect(() => { if (savedBiz !== undefined) setBizNo(savedBiz); }, [savedBiz]);
  useEffect(() => { setName(savedName ?? ''); }, [savedName]);

  const submit = async () => {
    if (!settings) return;
    setError(null);
    const digits = normalizeBizNo(bizNo);
    if (digits !== '' && digits.length !== 10) { setError('사업자등록번호는 숫자 10자리여야 합니다. 예: 123-45-67890'); return; }
    setBusy(true);
    try {
      const n = name.trim();
      await save({ ...settings, company: { bizNo: digits, ...(n ? { name: n } : {}) } });
      setBizNo(digits);
      toast.saved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="우리 회사" description="평가 점수 분석에서 우리 회사 기준으로 보기 위해 사업자등록번호를 입력하세요. 비워 두면 전체 업체 기준으로만 볼 수 있습니다.">
      <Field label="사업자등록번호" htmlFor="company-biz" help="하이픈은 있어도 됩니다. 저장하면 숫자 10자리로 정리됩니다.">
        <input id="company-biz" className={inputClass} value={bizNo} onChange={(e) => setBizNo(e.target.value)} placeholder="123-45-67890" />
      </Field>
      <Field label="회사명 (선택)" htmlFor="company-name">
        <input id="company-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <FormActions>
        <Button icon={<Save />} loading={busy} disabled={!settings} onClick={() => void submit()}>저장</Button>
      </FormActions>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {toast.node}
    </Card>
  );
}
