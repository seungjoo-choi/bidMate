import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { newId } from '../../../core/model/ids';
import type { TemplateFieldKey, TemplateItem, TemplateSection, TemplateStyle } from '../../../core/types/template';
import { VARIABLES, VARIABLE_BY_KEY } from '../../../core/templates/variables';
import { Button, Select, inputClass } from '../../../ui/components';
import { ConfirmDeleteButton } from '../recipients/shared';

type FocusEl = HTMLInputElement | HTMLTextAreaElement;

export interface SectionEditorProps {
  section: TemplateSection;
  index: number;
  /** 템플릿 전체에서 이미 쓰는 fieldKey. 항목 추가 목록에서 제외한다. */
  usedKeys: Set<TemplateFieldKey>;
  onChange: (next: TemplateSection) => void;
  onRemove: () => void;
  /** 위/아래로 옮긴다. 맨 위/맨 아래면 undefined. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onFocusInput: (el: FocusEl) => void;
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it as T);
  return next;
}

/** 굵게/밑줄 중 켜진 것만 담는다. 둘 다 꺼지면 undefined. */
function nextStyle(style: TemplateStyle | undefined, key: 'bold' | 'underline'): TemplateStyle | undefined {
  const on = !style?.[key];
  const bold = key === 'bold' ? on : !!style?.bold;
  const underline = key === 'underline' ? on : !!style?.underline;
  if (!bold && !underline) return undefined;
  return { ...(bold ? { bold: true } : {}), ...(underline ? { underline: true } : {}) };
}

function StyleToggles({ style, onChange }: { style: TemplateStyle | undefined; onChange: (next: TemplateStyle | undefined) => void }) {
  const cls = (on: boolean) => `h-8 w-8 shrink-0 rounded-ctl border text-sm transition-colors ${on ? 'border-line-strong bg-select text-ink' : 'border-transparent text-muted hover:bg-sunken hover:text-ink'}`;
  return (
    <>
      <button type="button" aria-label="굵게" aria-pressed={!!style?.bold} className={`${cls(!!style?.bold)} font-bold`} onClick={() => onChange(nextStyle(style, 'bold'))}>B</button>
      <button type="button" aria-label="밑줄" aria-pressed={!!style?.underline} className={`${cls(!!style?.underline)} underline`} onClick={() => onChange(nextStyle(style, 'underline'))}>U</button>
    </>
  );
}

/** style이 undefined면 속성 자체를 제거한다. */
function withStyle(it: TemplateItem, style: TemplateStyle | undefined): TemplateItem {
  const { style: _old, ...rest } = it;
  return (style ? { ...rest, style } : rest) as TemplateItem;
}

export function SectionEditor({ section, index, usedKeys, onChange, onRemove, onMoveUp, onMoveDown, onFocusInput }: SectionEditorProps) {
  const [addKey, setAddKey] = useState('');
  const available = VARIABLES.filter((d) => !usedKeys.has(d.fieldKey));
  const focus = (e: { currentTarget: FocusEl }) => onFocusInput(e.currentTarget);

  // 손잡이 드래그: 포인터를 손잡이에 붙잡아 두고, 다른 항목의 가운데를 넘으면 그 자리로 옮긴다.
  const listRef = useRef<HTMLUListElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const moveItem = (from: number, to: number) => onChange({ ...section, items: move(section.items, from, to) });
  const onGripDown = (e: PointerEvent<HTMLButtonElement>, i: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragIndex(i);
  };
  const onGripMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (dragIndex === null || !listRef.current) return;
    const rows = Array.from(listRef.current.querySelectorAll<HTMLLIElement>(':scope > li[data-item]'));
    const j = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return e.clientY >= b.top && e.clientY <= b.bottom; });
    if (j < 0 || j === dragIndex) return;
    const b = rows[j]!.getBoundingClientRect();
    const mid = b.top + b.height / 2;
    if ((j > dragIndex && e.clientY > mid) || (j < dragIndex && e.clientY < mid)) {
      moveItem(dragIndex, j);
      setDragIndex(j);
    }
  };
  const onGripEnd = () => setDragIndex(null);
  const onGripKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : null;
    if (to === null) return;
    e.preventDefault();
    if (to >= 0 && to < section.items.length) moveItem(i, to);
  };

  const setItem = (i: number, next: TemplateItem) => onChange({ ...section, items: section.items.map((x, j) => (j === i ? next : x)) });
  const setInline = (v: string) => {
    const { inlineValue: _old, ...rest } = section;
    onChange(v === '' ? rest : { ...rest, inlineValue: v });
  };

  const addText = () => {
    onChange({ ...section, items: [...section.items, { kind: 'text', id: newId('txt'), label: '새 항목', text: '', visible: true }] });
  };

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
        <Button variant="ghost" size="icon" aria-label="섹션 위로" disabled={!onMoveUp} icon={<ArrowUp />} onClick={onMoveUp} />
        <Button variant="ghost" size="icon" aria-label="섹션 아래로" disabled={!onMoveDown} icon={<ArrowDown />} onClick={onMoveDown} />
        <ConfirmDeleteButton title={`'${section.title || `섹션 ${index + 1}`}' 섹션을 삭제할까요?`} description="섹션 안의 항목도 함께 지워집니다." onConfirm={onRemove} />
      </div>
      <input
        aria-label={`섹션 ${index + 1} 제목 옆 값`}
        className={inputClass}
        placeholder="비우면 제목만 표시, {변수} 가능"
        value={section.inlineValue ?? ''}
        onFocus={focus}
        onChange={(e) => setInline(e.target.value)}
      />

      <ul ref={listRef} className={`space-y-2 ${dragIndex !== null ? 'select-none' : ''}`}>
        {section.items.map((it, i) => {
          const isText = it.kind === 'text';
          const varName = isText ? '문구' : (VARIABLE_BY_KEY.get(it.fieldKey)?.name ?? it.fieldKey);
          return (
            <li
              key={isText ? it.id : it.fieldKey}
              data-item
              className={`flex items-center gap-2 rounded-ctl ${dragIndex === i ? 'bg-surface shadow-raised ring-1 ring-line-strong' : ''}`}
            >
              <button
                type="button"
                aria-label={`${isText ? it.label || '문구' : varName} 옮기기 (위/아래 방향키)`}
                title="끌어서 순서 바꾸기"
                onPointerDown={(e) => onGripDown(e, i)}
                onPointerMove={onGripMove}
                onPointerUp={onGripEnd}
                onPointerCancel={onGripEnd}
                onKeyDown={(e) => onGripKey(e, i)}
                className={`flex h-10 w-5 shrink-0 touch-none items-center justify-center rounded-ctl text-faint hover:text-ink [&_svg]:size-4 ${dragIndex === i ? 'cursor-grabbing text-ink' : 'cursor-grab'}`}
              >
                <GripVertical />
              </button>
              <input
                type="checkbox"
                aria-label={`${isText ? it.label || '문구' : varName} 표시`}
                checked={it.visible}
                onChange={(e) => setItem(i, { ...it, visible: e.target.checked })}
                className="size-4 shrink-0 accent-[var(--color-accent)]"
              />
              <input
                aria-label="항목 라벨"
                className={inputClass}
                value={it.label}
                onFocus={focus}
                onChange={(e) => setItem(i, { ...it, label: e.target.value })}
              />
              {isText && (
                <input
                  aria-label="항목 문구"
                  className={inputClass}
                  placeholder="직접 입력 또는 {변수}"
                  value={it.text}
                  onFocus={focus}
                  onChange={(e) => setItem(i, { ...it, text: e.target.value })}
                />
              )}
              <span className="hidden w-28 shrink-0 truncate text-xs text-muted sm:block">{varName}</span>
              <StyleToggles style={it.style} onChange={(st) => setItem(i, withStyle(it, st))} />
              <Button variant="ghost" size="icon" aria-label="항목 삭제" icon={<Trash2 />} onClick={() => onChange({ ...section, items: section.items.filter((_, j) => j !== i) })} />
            </li>
          );
        })}
        {section.items.length === 0 && <li className="text-sm text-muted">항목이 없습니다.</li>}
      </ul>

      <div className="flex items-center gap-2">
        <Select
          aria-label="추가할 항목"
          value={addKey}
          clearable
          onChange={setAddKey}
          disabled={available.length === 0}
          placeholder={available.length === 0 ? '추가할 항목이 없습니다' : '추가할 항목을 선택하세요'}
          options={available.map((d) => ({ value: d.fieldKey, label: d.name, group: d.group }))}
        />
        <Button variant="secondary" icon={<Plus />} disabled={!addKey} onClick={addItem}>항목 추가</Button>
        <Button variant="secondary" icon={<Plus />} onClick={addText}>문구 추가</Button>
      </div>
    </div>
  );
}
