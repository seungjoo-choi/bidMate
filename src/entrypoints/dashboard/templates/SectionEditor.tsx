import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { TemplateFieldKey, TemplateSection } from '../../../core/types/template';
import { VARIABLES, VARIABLE_BY_KEY } from '../../../core/templates/variables';
import { Button, inputClass } from '../../../ui/components';
import { ConfirmDeleteButton } from '../recipients/shared';

type FocusEl = HTMLInputElement | HTMLTextAreaElement;

export interface SectionEditorProps {
  section: TemplateSection;
  index: number;
  /** 템플릿 전체에서 이미 쓰는 fieldKey. 항목 추가 목록에서 제외한다. */
  usedKeys: Set<TemplateFieldKey>;
  onChange: (next: TemplateSection) => void;
  onRemove: () => void;
  onFocusInput: (el: FocusEl) => void;
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it as T);
  return next;
}

export function SectionEditor({ section, index, usedKeys, onChange, onRemove, onFocusInput }: SectionEditorProps) {
  const [addKey, setAddKey] = useState('');
  const available = VARIABLES.filter((d) => !usedKeys.has(d.fieldKey));
  const focus = (e: { currentTarget: FocusEl }) => onFocusInput(e.currentTarget);

  const addItem = () => {
    const def = available.find((d) => d.fieldKey === addKey) ?? available[0];
    if (!def) return;
    onChange({ ...section, items: [...section.items, { fieldKey: def.fieldKey, label: def.label, visible: true }] });
    setAddKey('');
  };

  return (
    <div className="space-y-3 rounded-ctl border border-line bg-sunken p-4">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-sm font-semibold text-muted">{index + 1}.</span>
        <input
          aria-label={`섹션 ${index + 1} 제목`}
          className={inputClass}
          value={section.title}
          onFocus={focus}
          onChange={(e) => onChange({ ...section, title: e.target.value })}
        />
        <ConfirmDeleteButton onConfirm={onRemove} />
      </div>

      <ul className="space-y-2">
        {section.items.map((it, i) => (
          <li key={it.fieldKey} className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label={`${VARIABLE_BY_KEY.get(it.fieldKey)?.name ?? it.fieldKey} 표시`}
              checked={it.visible}
              onChange={(e) => onChange({ ...section, items: section.items.map((x, j) => (j === i ? { ...x, visible: e.target.checked } : x)) })}
              className="size-4 shrink-0 accent-[var(--color-accent)]"
            />
            <input
              aria-label="항목 라벨"
              className={inputClass}
              value={it.label}
              onFocus={focus}
              onChange={(e) => onChange({ ...section, items: section.items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
            />
            <span className="hidden w-28 shrink-0 truncate text-xs text-muted sm:block">{VARIABLE_BY_KEY.get(it.fieldKey)?.name ?? it.fieldKey}</span>
            <Button variant="ghost" size="icon" aria-label="위로" disabled={i === 0} icon={<ArrowUp />} onClick={() => onChange({ ...section, items: move(section.items, i, i - 1) })} />
            <Button variant="ghost" size="icon" aria-label="아래로" disabled={i === section.items.length - 1} icon={<ArrowDown />} onClick={() => onChange({ ...section, items: move(section.items, i, i + 1) })} />
            <Button variant="ghost" size="icon" aria-label="항목 삭제" icon={<Trash2 />} onClick={() => onChange({ ...section, items: section.items.filter((_, j) => j !== i) })} />
          </li>
        ))}
        {section.items.length === 0 && <li className="text-sm text-muted">항목이 없습니다.</li>}
      </ul>

      <div className="flex items-center gap-2">
        <select
          aria-label="추가할 항목"
          className={inputClass}
          value={addKey}
          onChange={(e) => setAddKey(e.target.value)}
          disabled={available.length === 0}
        >
          <option value="">{available.length === 0 ? '추가할 항목이 없습니다' : '추가할 항목 선택'}</option>
          {available.map((d) => <option key={d.fieldKey} value={d.fieldKey}>{d.group} / {d.name}</option>)}
        </select>
        <Button variant="secondary" icon={<Plus />} disabled={!addKey} onClick={addItem}>항목 추가</Button>
      </div>
    </div>
  );
}
