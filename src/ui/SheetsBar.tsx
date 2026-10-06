import { Plus } from 'lucide-react'
import { ru } from '../i18n/ru'

/** Панель листов (§6): вкладки слева, статус «показано N из M» справа. */
export function SheetsBar() {
  return (
    <div className="sheets-bar">
      <div className="sheets-tabs" role="tablist" aria-label="Листы книги">
        <button
          type="button"
          role="tab"
          aria-selected="true"
          className="sheet-tab sheet-tab-active"
        >
          {ru.sheet}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label={ru.addSheetLabel}
          title={ru.addSheetLabel}
        >
          <Plus size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      <span className="sheets-note">{ru.sheetsEmpty}</span>
    </div>
  )
}
