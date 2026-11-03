/** 평가 수집 오류 코드별 사용자 문구(대시보드와 나라장터 패널 공용) */
export function evalErrorText(code: string | undefined, message: string): string {
  switch (code) {
    case 'EVAL_NOT_LOGGED_IN': return '나라장터에 로그인한 뒤 다시 시도하세요.';
    case 'EVAL_NO_RESULT': return '평가 결과가 없는 공고입니다. 개찰이 끝난 협상에 의한 계약 공고인지 확인하세요.';
    case 'EVAL_NO_SYSTEM': return '발주기관이 나라장터 평가시스템을 쓰지 않아 평가점수가 없는 공고입니다.';
    case 'EVAL_CS_UNREACHABLE': return '나라장터 탭에 연결하지 못했습니다. 나라장터 탭을 새로고침하거나 닫은 뒤 다시 시도하세요.';
    case 'TIMEOUT': return '응답 시간이 지났습니다. 나라장터 탭을 확인하고 다시 시도하세요.';
    case 'NEEDS_FS_PERMISSION': return '저장 폴더 권한이 필요합니다. 설정에서 폴더를 다시 연결하세요.';
    default: return message || '평가점수를 가져오지 못했습니다.';
  }
}
