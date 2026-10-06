import { FormulaBar } from '../ui/FormulaBar'
import { GridPlaceholder } from '../ui/GridPlaceholder'
import { SheetsBar } from '../ui/SheetsBar'
import { StatusBar } from '../ui/StatusBar'
import { Toolbar } from '../ui/Toolbar'

/**
 * Главный экран NovaGrid (один экран — роутинга в v1 нет, ARCHITECTURE §6).
 * Раскладка сверху вниз: тулбар → строка формул → грид → панель листов →
 * статус-бар (DESIGN-SYSTEM §6).
 */
export default function App() {
  return (
    <div className="app-shell">
      <Toolbar />
      <FormulaBar />
      <GridPlaceholder />
      <SheetsBar />
      <StatusBar />
    </div>
  )
}
