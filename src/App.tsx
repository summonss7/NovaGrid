import { average, sum } from './core/stats'

interface Row {
  name: string
  city: string
  amount: number
  found?: boolean
}

const ROWS: Row[] = [
  { name: 'Иванов', city: 'Москва', amount: 1200, found: true },
  { name: 'Петров', city: 'Казань', amount: 10000, found: true },
  { name: 'Сидоров', city: 'Тула', amount: 2000 },
  { name: 'Кузнецов', city: 'Пермь', amount: 500 },
]

const COLUMNS = ['Фамилия', 'Город', 'Сумма']

export default function App() {
  const filteredAmounts = ROWS.filter((r) => r.found).map((r) => r.amount)
  const total = sum(ROWS.map((r) => r.amount))

  return (
    <div className="app">
      <header className="toolbar">
        <span className="logo">
          <span className="logo-mark">N</span>
          <span className="logo-name">NovaGrid</span>
        </span>
        <span className="toolbar-note">Этап 0 — каркас · таблица появится на Этапе 1</span>
      </header>

      <main className="sheet">
        <table className="grid-mock">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.name} className={r.found ? 'row-found' : undefined}>
                <td>{r.name}</td>
                <td>{r.city}</td>
                <td className="cell-number">{r.amount.toLocaleString('ru-RU')}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="sum-card">
          <button type="button" className="sum-btn" aria-label="Сумма выделенного">
            Σ
          </button>
          <div>
            <div className="sum-value">{sum(filteredAmounts).toLocaleString('ru-RU')}</div>
            <div className="sum-caption">
              Σ отфильтрованных · n {filteredAmounts.length} · x̄{' '}
              {average(filteredAmounts).toLocaleString('ru-RU')}
            </div>
          </div>
        </div>
      </main>

      <footer className="statusbar">
        <span>строк: {ROWS.length}</span>
        <span>всего: {total.toLocaleString('ru-RU')}</span>
      </footer>
    </div>
  )
}
