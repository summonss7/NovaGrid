import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'

export type SaveAsFormat = 'xlsx' | 'ods' | 'csv' | 'nvgridx'

export interface SaveAsChoice {
  fileName: string
  format: SaveAsFormat
  delimiter: string
  /** парольная фраза капсулы .nvgridx (валидирована диалогом, ≥4 символов) */
  passphrase?: string
}

interface SaveAsDialogProps {
  suggestedName: string
  defaultFormat: SaveAsFormat
  defaultDelimiter: string
  /** заметка о конверте (.xls/.ods пишутся как .xlsx) — под выбором формата */
  convertNote: string | null
  onConfirm: (choice: SaveAsChoice) => void
  onCancel: () => void
}

/**
 * Диалог «Сохранить как…» (Этап 2.3): имя, формат (xlsx/csv), разделитель CSV.
 * Этап 7.6 (novagrid-019) добавляет третий формат .nvgridx — зашифрованную
 * капсулу-снапшот для облачной синхронизации: вместо разделителя спрашиваются
 * парольная фраза и её повтор (несовпадение/короткая — инлайн-ошибкой).
 */
export function SaveAsDialog(props: SaveAsDialogProps) {
  const t = useT()
  const base = props.suggestedName.replace(/\.(xlsx|xlsm|csv|tsv|xls|ods|nvgridx)$/i, '')
  const [name, setName] = useState(base)
  const [format, setFormat] = useState<SaveAsFormat>(props.defaultFormat)
  const [delimiter, setDelimiter] = useState(props.defaultDelimiter)
  const [pass, setPass] = useState('')
  const [passRepeat, setPassRepeat] = useState('')
  const [passError, setPassError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.select()
  }, [])

  const confirm = () => {
    const clean = name.trim() || t.newBook
    if (format === 'nvgridx') {
      if (pass.length < 4) {
        setPassError(t.snapshotPassShort)
        return
      }
      if (pass !== passRepeat) {
        setPassError(t.snapshotPassMismatch)
        return
      }
      props.onConfirm({ fileName: `${clean}.${format}`, format, delimiter, passphrase: pass })
      return
    }
    props.onConfirm({ fileName: `${clean}.${format}`, format, delimiter })
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t.saveAsTitle}>
        <h2 className="dialog-title">{t.saveAsTitle}</h2>

        <label className="dialog-field">
          <span className="dialog-label">{t.saveAsNameLabel}</span>
          <input
            ref={nameRef}
            className="dialog-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirm()
              else if (e.key === 'Escape') props.onCancel()
            }}
            spellCheck={false}
            autoFocus
          />
        </label>

        <div className="dialog-row">
          <label className="dialog-field">
            <span className="dialog-label">{t.saveAsFormatLabel}</span>
            <select
              className="dialog-select"
              value={format}
              onChange={(e) => {
                setFormat(e.target.value as SaveAsFormat)
                setPassError(null)
              }}
            >
              <option value="xlsx">{t.saveAsFormatXlsx}</option>
              <option value="ods">{t.saveAsFormatOds}</option>
              <option value="csv">{t.saveAsFormatCsv}</option>
              <option value="nvgridx">{t.saveAsFormatNvgridx}</option>
            </select>
          </label>
          {format === 'csv' && (
            <label className="dialog-field">
              <span className="dialog-label">{t.saveAsDelimiterLabel}</span>
              <select
                className="dialog-select"
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value)}
              >
                <option value=";">{t.semicolon}</option>
                <option value=",">{t.comma}</option>
                <option value={'\t'}>{t.tab}</option>
              </select>
            </label>
          )}
        </div>

        {format === 'nvgridx' && (
          <>
            <div className="dialog-row">
              <label className="dialog-field">
                <span className="dialog-label">{t.snapshotPassLabel}</span>
                <input
                  className="dialog-input"
                  type="password"
                  value={pass}
                  autoComplete="new-password"
                  onChange={(e) => {
                    setPass(e.target.value)
                    setPassError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirm()
                    else if (e.key === 'Escape') props.onCancel()
                  }}
                />
              </label>
              <label className="dialog-field">
                <span className="dialog-label">{t.snapshotPassRepeatLabel}</span>
                <input
                  className="dialog-input"
                  type="password"
                  value={passRepeat}
                  autoComplete="new-password"
                  onChange={(e) => {
                    setPassRepeat(e.target.value)
                    setPassError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirm()
                    else if (e.key === 'Escape') props.onCancel()
                  }}
                />
              </label>
            </div>
            <p className="dialog-note">{t.snapshotNote}</p>
            {passError && (
              <p className="dialog-error" role="alert">
                {passError}
              </p>
            )}
          </>
        )}

        {props.convertNote && format === 'xlsx' && (
          <p className="dialog-note">{props.convertNote}</p>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
            {t.cancelAction}
          </button>
          <button type="button" className="btn btn-primary" onClick={confirm}>
            {t.saveAction}
          </button>
        </div>
      </div>
    </div>
  )
}
