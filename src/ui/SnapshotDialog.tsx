import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'

interface SnapshotDialogProps {
  /** имя открытого файла .nvgridx — показывается в шапке диалога */
  fileName: string
  /** расшифровать и открыть; reject текстом — фраза неверная/файл битый */
  onOpen: (passphrase: string) => Promise<void>
  onCancel: () => void
}

/**
 * Диалог открытия снапшота .nvgridx (Этап 7.6, novagrid-019): капсула уже
 * прочитана с диска, осталось ввести парольную фразу. Неверная фраза —
 * инлайн-ошибка и повтор (диалог не закрывается), Esc/«Отмена» — отказ.
 */
export function SnapshotDialog(props: SnapshotDialogProps) {
  const t = useT()
  const [pass, setPass] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const passRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    passRef.current?.focus()
  }, [])

  const open = async () => {
    if (pass === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      await props.onOpen(pass)
    } catch (err) {
      // неверная фраза/битый файл — остаёмся в диалоге, можно повторить
      setError(err instanceof Error && /фраза|поврежд|снапшот/.test(err.message)
        ? t.snapshotImportWrongPass
        : err instanceof Error
          ? err.message
          : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t.snapshotImportTitle}>
        <h2 className="dialog-title">{t.snapshotImportTitle}</h2>

        <label className="dialog-field">
          <span className="dialog-label">{t.snapshotImportFileLabel}</span>
          <span className="dialog-input dialog-value">{props.fileName}</span>
        </label>

        <label className="dialog-field">
          <span className="dialog-label">{t.snapshotPassLabel}</span>
          <input
            ref={passRef}
            className="dialog-input"
            type="password"
            value={pass}
            autoComplete="off"
            disabled={busy}
            onChange={(e) => {
              setPass(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void open()
              else if (e.key === 'Escape') props.onCancel()
            }}
          />
        </label>

        <p className="dialog-note">{t.snapshotImportNote}</p>
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
            {t.cancelAction}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pass === '' || busy}
            onClick={() => void open()}
          >
            {t.snapshotImportAction}
          </button>
        </div>
      </div>
    </div>
  )
}
