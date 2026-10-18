/** 메일 본문 미리보기 액자 크기. 받는 사람 화면과 비슷한 고정 폭을 쓴다. */
const FRAME_WIDTH = 720;

/** 메일 클라이언트 기본 글꼴과 비슷하게 맞춘 미리보기 전용 문서 스타일. 렌더 결과(html)에는 넣지 않는다. */
const BASE_STYLE =
  'body{margin:0;padding:20px 24px;font-family:-apple-system,"Malgun Gothic","Apple SD Gothic Neo",sans-serif;font-size:14px;line-height:1.6;color:#1b1b19;background:#fff}' +
  'h3{font-size:15px;margin:18px 0 6px}th{font-weight:600;color:#3a3a37}a{color:#2a4f86}';

export interface MailPreviewFrameProps {
  /** renderMail이 만든 본문 HTML. 스크립트가 돌지 않도록 sandbox iframe 안에만 넣는다. */
  html: string;
  subject?: string;
  height?: number;
}

/** 렌더된 메일 본문을 격리해 보여 준다. dangerouslySetInnerHTML을 쓰지 않는다. */
export function MailPreviewFrame({ html, subject, height = 560 }: MailPreviewFrameProps) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_STYLE}</style></head><body>${html}</body></html>`;
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card" style={{ maxWidth: FRAME_WIDTH }}>
      {subject !== undefined && (
        <div className="border-b border-line px-6 py-3">
          <p className="text-xs text-muted">제목</p>
          <p className="mt-0.5 text-sm font-semibold text-ink break-all">{subject || '(제목 없음)'}</p>
        </div>
      )}
      <iframe title="메일 본문 미리보기" sandbox="" srcDoc={doc} className="block w-full" style={{ height, border: 0 }} />
    </div>
  );
}
