import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_NAME_PREFIX } from '../../core/model/default-settings';
import { withNamePrefix } from '../../core/model/names';
import { Button, Card, Field, FormActions, InlineAlert } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';
import { useSettings } from '../../ui/hooks/useSettings';

/** 파일명에 쓸 수 없는 문자 */
const ILLEGAL = /[\\/:*?"<>|]/;

export function FileNameCard() {
  const { settings, save } = useSettings();
  const [enabled, setEnabled] = useState(true);
  const [text, setText] = useState(DEFAULT_NAME_PREFIX);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const savedEnabled = settings?.download.namePrefix.enabled;
  const savedText = settings?.download.namePrefix.text;
  useEffect(() => { if (savedEnabled !== undefined) setEnabled(savedEnabled); }, [savedEnabled]);
  useEffect(() => { if (savedText !== undefined) setText(savedText); }, [savedText]);

  const trimmed = text.trim();
  const submit = async () => {
    if (!settings) return;
    setError(null);
    setDone(false);
    if (enabled && trimmed === '') { setError('붙일 문구를 입력하세요.'); return; }
    if (ILLEGAL.test(trimmed) || trimmed.includes('..')) { setError('파일 이름에 쓸 수 없는 문자(\\ / : * ? " < > |)와 마침표 두 개(..)는 넣을 수 없습니다.'); return; }
    setBusy(true);
    try {
      await save({ ...settings, download: { ...settings.download, namePrefix: { enabled, text: trimmed } } });
      setText(trimmed);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const example = withNamePrefix('공고문.hwp', enabled && trimmed ? trimmed : undefined);

  return (
    <Card title="파일 이름 태그" description="첨부파일을 저장 폴더에 받을 때 파일 이름 앞에 보안 등급 문구를 붙입니다. 추출한 텍스트 파일과 메일로 보내는 첨부에도 같은 이름이 붙고, 대시보드 화면에서는 문구를 빼고 보여 줍니다.">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink">
        <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={enabled} disabled={!settings || busy} onChange={(e) => setEnabled(e.target.checked)} />
        파일 이름 앞에 문구 붙이기
      </label>
      <Field label="붙일 문구" htmlFor="name-prefix" help={`문구와 파일 이름 사이는 자동으로 한 칸 띄웁니다. 예: ${example}`}>
        <input id="name-prefix" className={inputClass} value={text} disabled={!enabled} onChange={(e) => setText(e.target.value)} placeholder={DEFAULT_NAME_PREFIX} />
      </Field>
      <p className="text-sm text-muted">바꾼 설정은 다음에 받는 파일부터 적용됩니다. 이미 받은 파일의 이름은 바뀌지 않습니다.</p>
      <FormActions>
        <Button icon={<Save />} loading={busy} disabled={!settings} onClick={() => void submit()}>저장</Button>
      </FormActions>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {done && <InlineAlert tone="ok">저장했습니다.</InlineAlert>}
    </Card>
  );
}
