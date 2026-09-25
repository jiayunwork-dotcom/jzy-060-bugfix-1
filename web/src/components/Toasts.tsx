/** 右上角弹出提醒（严重为红、警告为黄），自动淡出，可手动关闭。 */
import { useDashboard } from '../store/useDashboard';
import { formatClock } from '../utils/format';

export default function Toasts() {
  const toasts = useDashboard((s) => s.toasts);
  const dismiss = useDashboard((s) => s.dismissToast);

  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.level}`}>
          <div className="toast-head">
            <span className="toast-badge">{t.level === 'critical' ? '严重告警' : t.level === 'warning' ? '警告' : '提示'}</span>
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="关闭提醒">
              ×
            </button>
          </div>
          <div className="toast-title">{t.title}</div>
          <div className="toast-message">{t.message}</div>
          <div className="toast-ts">{formatClock(t.ts)}</div>
        </div>
      ))}
    </div>
  );
}
