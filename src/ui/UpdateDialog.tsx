import { useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { useT } from '../i18n'
import { useUpdaterStore } from '../io/updater'

/*
 * Диалог OTA-обновления десктопа (novagrid-036): исход проверки канала Aila
 * («✓ последняя версия» / «⬆ доступна X» + что нового), скачивание с
 * прогрессом и перезапуск после rename-swap. Открывается тихой проверкой
 * при старте (только если есть обновление) или пунктом «Справка →
 * Проверить обновления…». В браузере/PWA не живёт — обновляет Service Worker.
 */

const mb = (n: number): string => `${(n / 1048576).toFixed(1)} МБ`

export function UpdateDialog() {
  const t = useT()
  const status = useStore(useUpdaterStore, (s) => s.status)
  const latest = useStore(useUpdaterStore, (s) => s.latest)
  const current = useStore(useUpdaterStore, (s) => s.current)
  const notes = useStore(useUpdaterStore, (s) => s.notes)
  const downloaded = useStore(useUpdaterStore, (s) => s.downloaded)
  const total = useStore(useUpdaterStore, (s) => s.total)
  const error = useStore(useUpdaterStore, (s) => s.error)
  const installRef = useRef<HTMLButtonElement>(null)

  // при доступном обновлении фокус на «Обновить» — Enter ставит сразу
  useEffect(() => {
    if (status === 'available') installRef.current?.focus({ preventScroll: true })
  }, [status])

  const busy = status === 'downloading' || status === 'restarting'
  const close = () => {
    if (!busy) useUpdaterStore.getState().closeDialog()
  }
  const retry = () => void useUpdaterStore.getState().check(true)

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.currentTarget === e.target) close()
      }}
    >
      <div
        className="dialog update-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t.updTitle}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
        }}
      >
        <h2 className="dialog-title">
          {status === 'available' || status === 'downloading' || status === 'restarting'
            ? t.updAvailableTitle(latest ?? '')
            : t.updTitle}
        </h2>

        {status === 'checking' && <p className="dialog-note">{t.updChecking}</p>}

        {status === 'latest' && (
          <p className="dialog-note">
            {t.updLatestTitle}
            <br />
            {t.updLatestBody(current)}
          </p>
        )}

        {(status === 'available' || status === 'downloading' || status === 'restarting') && (
          <>
            <p className="dialog-note">{t.updCurrentLabel(current)}</p>
            {notes && (
              <div className="upd-notes">
                <p className="upd-notes-title">{t.updWhatsNew}</p>
                <p className="upd-notes-body">{notes}</p>
              </div>
            )}
            <p className="dialog-note">{t.updSessionNote}</p>
          </>
        )}

        {status === 'downloading' && (
          <div className="upd-progress" role="status">
            <div className="upd-progress-bar" aria-hidden>
              <div
                className="upd-progress-fill"
                style={{ width: total > 0 ? `${Math.min(100, (downloaded / total) * 100)}%` : '0%' }}
              />
            </div>
            <span className="upd-progress-text">
              {t.updDownloading} {mb(downloaded)}
              {total > 0 ? ` / ${mb(total)}` : ''}
            </span>
          </div>
        )}

        {status === 'restarting' && <p className="dialog-note">{t.updRestarting}</p>}

        {status === 'error' && (
          <>
            <p className="dialog-error">{t.updErrorTitle}</p>
            {error && <p className="dialog-note">{error}</p>}
          </>
        )}

        <div className="dialog-actions">
          {status === 'available' && (
            <>
              <button type="button" className="btn btn-ghost" onClick={close}>
                {t.updLater}
              </button>
              <button
                ref={installRef}
                type="button"
                className="btn btn-primary"
                onClick={() => void useUpdaterStore.getState().install()}
              >
                {t.updInstall}
              </button>
            </>
          )}
          {status === 'error' && (
            <>
              <button type="button" className="btn btn-ghost" onClick={close}>
                {t.updClose}
              </button>
              <button type="button" className="btn btn-primary" onClick={retry}>
                {t.updRetry}
              </button>
            </>
          )}
          {(status === 'checking' || status === 'latest') && (
            <button type="button" className="btn btn-primary" onClick={close}>
              {t.updClose}
            </button>
          )}
          {/* downloading/restarting: кнопок нет — идёт необратимый шаг */}
        </div>
      </div>
    </div>
  )
}
