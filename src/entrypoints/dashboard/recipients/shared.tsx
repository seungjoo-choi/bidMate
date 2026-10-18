import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../ui/components';

export interface OpError { code: string; message: string; path?: string }

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL: '이메일 형식이 올바르지 않습니다.',
  DUPLICATE_EMAIL: '이미 등록된 이메일입니다.',
  DUPLICATE_NAME: '같은 이름의 그룹이 이미 있습니다.',
  INVALID_VALUE: '입력값이 올바르지 않습니다. 이름은 필수이며 길이 제한을 확인해 주세요.',
  NOT_FOUND: '대상을 찾을 수 없습니다. 목록을 새로 불러와 주세요.',
};

export function errorText(e: OpError): string {
  return MESSAGES[e.code] ?? `${e.code}: ${e.message}`;
}

/** 클릭하면 "정말 삭제"로 바뀌고 3초 뒤 원래대로 돌아가는 2단계 삭제 버튼. */
export function ConfirmDeleteButton({ onConfirm, disabled }: { onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const click = () => {
    if (armed) {
      clearTimeout(timer.current);
      setArmed(false);
      onConfirm();
      return;
    }
    setArmed(true);
    timer.current = setTimeout(() => setArmed(false), 3000);
  };
  return (
    <Button variant={armed ? 'primary' : 'ghost'} disabled={disabled} onClick={click} className={armed ? '' : 'text-danger'}>
      {armed ? '정말 삭제' : '삭제'}
    </Button>
  );
}
