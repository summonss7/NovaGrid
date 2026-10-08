/*
 * Undo/Redo — delta-стек изменённых ячеек (решение спайка Этапа 1,
 * docs/SPIKE-1-GRID.md): одна запись = одна транзакция правок «было → стало».
 * В отличие от снимков состояния (zundo), стек хранит только изменённые
 * ячейки — на листе 100k×30 шаг истории весит байты, а не копию всей Map.
 */

export interface CellChange {
  row: number
  col: number
  before: string
  after: string
}

export interface HistoryEntry {
  label: string
  changes: CellChange[]
}

const DEFAULT_LIMIT = 100

export class History {
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []

  constructor(private readonly limit: number = DEFAULT_LIMIT) {}

  /** Записать транзакцию; после записи redo-ветка сбрасывается (как в Excel). */
  push(entry: HistoryEntry): void {
    this.undoStack.push(entry)
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack = []
  }

  /** Снять транзакцию для отката; применить нужно её changes в направлении before. */
  undo(): HistoryEntry | null {
    const entry = this.undoStack.pop() ?? null
    if (entry) this.redoStack.push(entry)
    return entry
  }

  redo(): HistoryEntry | null {
    const entry = this.redoStack.pop() ?? null
    if (entry) this.undoStack.push(entry)
    return entry
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}

/** Применить изменения к листу в указанном направлении (вызывает store). */
export type ApplyChanges = (changes: readonly CellChange[], direction: 'before' | 'after') => void
