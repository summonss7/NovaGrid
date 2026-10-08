import { useEffect, useRef, useState } from 'react'
import { ru } from '../i18n/ru'

export type SaveAsFormat = 'xlsx' | 'csv'

export interface SaveAsChoice {
  fileName: string
  format: SaveAsFormat
  delimiter: string
}

interface SaveAsDialogProps {
  suggestedName: string
  defaultFormat: SaveAsFormat
  defaultDelimiter: string
  showXlsNote: boolean
  onConfirm: (choice: SaveAsChoice) => void
  onCancel: () => void
}

/** Диалог «Сохранить как…» (Этап 2.3): имя, формат (xlsx/csv), разделитель CSV. */
export function SaveAsDialog(props: SaveAsDialogProps) {
  const base = props.suggestedName.replace(/\.(xlsx|xlsm|csv|tsv|xls)$/i, '')
  const [name, setName] = useState(base)
  const [format, setFormat] = useState<SaveAsFormat>(props.defaultFormat)
  const [delimiter, setDelimiter] = useState(props.defaultDelimiter)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.select()
  }, [])

  const confirm = () => {
    const clean = name.trim() || 'Новая таблица'
    props.onConfirm({
      fileName: `${clean}.${format}`,
      format,
      delimiter,
    })
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={ru.saveAsTitle}>
        <h2 className="dialog-title">{ru.saveAsTitle}</h2>

        <label className="dialog-field">
          <span className="dialog-label">{ru.saveAsNameLabel}</span>
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
            <span className="dialog-label">{ru.saveAsFormatLabel}</span>
            <select
              className="dialog-select"
              value={format}
              onChange={(e) => setFormat(e.target.value as SaveAsFormat)}
            >
              <option value="xlsx">.xlsx (Excel, со стилями)</option>
              <option value="csv">.csv (активный лист)</option>
            </select>
          </label>
          {format === 'csv' && (
            <label className="dialog-field">
              <span className="dialog-label">{ru.saveAsDelimiterLabel}</span>
              <select
                className="dialog-select"
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value)}
              >
                <option value=";">{ru.semicolon}</option>
                <option value=",">{ru.comma}</option>
                <option value={'\t'}>{ru.tab}</option>
              </select>
            </label>
          )}
        </div>

        {props.showXlsNote && format === 'xlsx' && <p className="dialog-note">{ru.xlsSaveNote}</p>}

        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
            {ru.cancelAction}
          </button>
          <button type="button" className="btn btn-primary" onClick={confirm}>
            {ru.saveAction}
          </button>
        </div>
      </div>
    </div>
  )
}
