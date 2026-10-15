import { useEffect, useRef } from 'react'
import { useT } from '../i18n'

/*
 * Диалог закрытия с несохранёнными правками (novagrid-033): обёртка погасила
 * крестик и спросила фронтенд. Excel-тройка «Сохранить / Не сохранять /
 * Отмена»: Enter — сохранить, Esc — остаться. Слова «закрыть окно» важны —
 * в браузере тот же случай показывает системный beforeunload без кнопки
 * сохранения, а здесь выбор полный.
 */

interface CloseAskDialogProps {
  /** имя книги для текста (null — новая несохранённая) */
  fileName: string | null
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

export function CloseAskDialog(props: CloseAskDialogProps) {
  const t = useT()
  const saveRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    saveRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t.closeAskTitle}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onCancel()
        }}
      >
        <h2 className="dialog-title">{t.closeAskTitle}</h2>
        <p className="dialog-note">
          {props.fileName
            ? t.closeAskMessage(props.fileName)
            : t.closeAskMessageUnnamed}
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
            {t.cancelAction}
          </button>
          <button type="button" className="btn btn-ghost" onClick={props.onDiscard}>
            {t.closeAskDiscard}
          </button>
          <button
            ref={saveRef}
            type="button"
            className="btn btn-primary"
            onClick={props.onSave}
          >
            {t.saveAction}
          </button>
        </div>
      </div>
    </div>
  )
}
