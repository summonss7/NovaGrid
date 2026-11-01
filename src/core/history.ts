/*
 * Undo/Redo — delta-стек изменённых ячеек (решение спайка Этапа 1,
 * docs/SPIKE-1-GRID.md): одна запись = одна транзакция правок «было → стало».
 * В отличие от снимков состояния (zundo), стек хранит только изменённые
 * ячейки — на листе 100k×30 шаг истории весит байты, а не копию всей Map.
 */

import type { CellStyle, SheetModel } from './sheet'

export interface CellChange {
  row: number
  col: number
  before: string
  after: string
}

/**
 * Правка стиля ячейки (novagrid-039): before/after — полные стили;
 * undefined — стиля нет. Запись истории может нести и значения, и стили.
 */
export interface StyleChange {
  row: number
  col: number
  before?: CellStyle
  after?: CellStyle
}

export interface HistoryEntry {
  label: string
  changes: CellChange[]
  /**
   * Метка сквозной транзакции (Этап 7): батч «заменить все» по книге пишет
   * по записи в историю каждой вкладки с одной меткой — undo/redo снимает
   * их со всех вкладок разом, одним Ctrl+Z.
   */
  group?: string
  /** стилевые правки той же транзакции (novagrid-039); может быть пустым */
  styleChanges?: StyleChange[]
  /**
   * Операция вставки/удаления строк/колонок (novagrid-045): дифф тысяч ячеек
   * неэкономен, поэтому запись несёт снимки листа до/после — Maps иммутабельны,
   * хранятся по ссылке. undo/redo подставляет снимок целиком; changes пуст.
   */
  layout?: { before: SheetModel; after: SheetModel }
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

  /** Верхняя запись redo-стека без снятия (группировка батча Этапа 7). */
  peekRedo(): HistoryEntry | null {
    return this.redoStack[this.redoStack.length - 1] ?? null
  }

  /** Верхняя запись undo-стека без снятия (группировка батча Этапа 7). */
  peek(): HistoryEntry | null {
    return this.undoStack[this.undoStack.length - 1] ?? null
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
