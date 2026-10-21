import { Info } from 'lucide-react';
import { useState } from 'react';
import type { Settings } from '../../core/types/settings';
import { Card, InlineAlert } from '../../ui/components';
import { useSettings } from '../../ui/hooks/useSettings';

type NotifyKey = keyof Settings['notify'];

const isMac = /Mac/i.test(navigator.userAgent);
const KBD = 'rounded border border-line-strong bg-surface px-1 font-sans text-xs text-ink';

const OPTIONS: Array<{ key: NotifyKey; title: string; desc: string; preview: { title: string; lines: string[] } }> = [
  {
    key: 'rank',
    title: '개찰 순위가 나오면 알림',
    desc: '우리 회사가 몇 위인지 먼저 알려 드립니다. 최종 낙찰이 아니라 중간 결과입니다. 개찰 결과만 팔로우한 공고는 이 알림을 끝으로 팔로우가 해제됩니다.',
    preview: { title: '개찰 순위 확인', lines: ['2026년 차세대 지방세정보시스템 고도화 사업', '우리 1위, 참여 5개사'] },
  },
  {
    key: 'final',
    title: '최종 결과가 나오면 알림',
    desc: '낙찰, 탈락, 유찰이 확정되거나 120일 동안 결과가 나오지 않아 추적을 끝낼 때 알려 드립니다. 알림이 오면 팔로우는 자동으로 해제됩니다.',
    preview: { title: '낙찰', lines: ['공공데이터 개방 플랫폼 유지관리 용역', '낙찰되었습니다'] },
  },
  {
    key: 'deadline',
    title: '마감이 다가오면 알림',
    desc: '메일 전달을 마쳤거나 팔로우한 공고의 입찰 마감과 참가등록 마감을 D-3, D-1, 당일 09:00에 알려 드립니다.',
    preview: { title: '입찰 마감 D-1', lines: ['2026년 차세대 지방세정보시스템 고도화 사업 10/22 14:00 마감'] },
  },
];

/** 켜고 끄는 스위치. 누르면 바로 저장한다. */
function Switch({ id, on, disabled, onChange, labelledBy }: { id: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void; labelledBy: string }) {
  return (
    <button
      id={id} type="button" role="switch" aria-checked={on} aria-labelledby={labelledBy} disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${on ? 'bg-primary' : 'bg-line-strong'}`}
    >
      <span className={`absolute top-[3px] size-4 rounded-full bg-white shadow-btn transition-[left] motion-reduce:transition-none ${on ? 'left-[19px]' : 'left-[3px]'}`} />
    </button>
  );
}

function Preview({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div aria-hidden className="mt-2.5 flex w-full max-w-[340px] items-start gap-2.5 rounded-xl border border-line bg-sunken px-3 py-2.5">
      <img src="/icon/48.png" alt="" className="size-7 shrink-0 rounded-md" />
      <div className="min-w-0 text-xs leading-snug">
        <div className="font-bold text-ink">{title}</div>
        {lines.map((l, i) => <div key={i} className={i === 0 && lines.length > 1 ? 'truncate text-muted' : 'text-muted'}>{l}</div>)}
      </div>
    </div>
  );
}

export function NotifyCard() {
  const { settings, save } = useSettings();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = async (key: NotifyKey, value: boolean) => {
    if (!settings) return;
    setError(null);
    setSaving(true);
    try {
      await save({ ...settings, notify: { ...settings.notify, [key]: value } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="알림" description="팔로우한 공고의 결과와 입찰 마감을 화면 오른쪽 위에 알림으로 띄웁니다. 다른 프로그램을 보고 있어도 뜹니다.">
      <ul className="-my-1 divide-y divide-line">
        {OPTIONS.map((o) => (
          <li key={o.key} className="flex gap-3.5 py-4 first:pt-1">
            <Switch id={`notify-${o.key}`} labelledBy={`notify-${o.key}-t`} on={!!settings?.notify[o.key]} disabled={!settings || saving} onChange={(v) => void set(o.key, v)} />
            <div className="min-w-0">
              <label htmlFor={`notify-${o.key}`} id={`notify-${o.key}-t`} className="cursor-pointer font-semibold text-ink">{o.title}</label>
              <p className="text-sm text-muted">{o.desc}</p>
              <Preview {...o.preview} />
            </div>
          </li>
        ))}
      </ul>
      <div className="flex gap-2.5 rounded-ctl bg-sunken px-3.5 py-3 text-sm text-muted">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        {/* OS별로 설정 경로·집중 모드 이름·종료 단축키가 다르다(Windows Chrome 종료는 Ctrl+Shift+Q). */}
        {isMac ? (
          <p>
            알림이 안 보이면 맥의 <b className="font-semibold text-ink">시스템 설정 &gt; 알림 &gt; Google Chrome</b>에서 알림 허용을 켜 주세요.
            집중 모드 중에는 알림 센터에만 쌓입니다. Chrome을 <kbd className={KBD}>⌘Q</kbd>로 완전히 끄면 확인이 멈추고, 다시 켤 때 밀린 확인을 한 번 합니다.
          </p>
        ) : (
          <p>
            알림이 안 보이면 Windows의 <b className="font-semibold text-ink">설정 &gt; 시스템 &gt; 알림 &gt; Google Chrome</b>에서 알림을 켜 주세요.
            방해 금지 중에는 알림 센터에만 쌓입니다. Chrome을 <kbd className={KBD}>Ctrl+Shift+Q</kbd>로 완전히 끄면 확인이 멈추고, 다시 켤 때 밀린 확인을 한 번 합니다.
          </p>
        )}
      </div>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
    </Card>
  );
}
