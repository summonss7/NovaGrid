/*
 * Состояние зума таблицы (Этап 5.3): пинч на тач-экране, Ctrl+колесо и
 * кнопки −/+ в статус-баре пишут сюда; GridCanvas подписан и применяет
 * METRICS + корректировку прокрутки под якорь жеста. Отдельный стор, а не
 * gridStore: зум — свойство вьюпорта, а не книги (правки/undo его не видят).
 */

import { create } from 'zustand'
import { applyZoom } from './geometry'

/** Якорь зума в координатах вьюпорта грида (точка, которая остаётся на месте). */
export interface ZoomAnchor {
  x: number
  y: number
}

interface ZoomState {
  zoom: number
  /** якорь последнего изменения (одноразовый — GridCanvas снимает) */
  anchor: ZoomAnchor | null
  setZoom: (z: number, anchor?: ZoomAnchor) => void
  clearAnchor: () => void
}

export const zoomStore = create<ZoomState>((set) => ({
  zoom: 1,
  anchor: null,
  // applyZoom сразу меняет METRICS — эффект GridCanvas пересчитает прокрутку
  setZoom: (z, anchor) => set({ zoom: applyZoom(z), anchor: anchor ?? null }),
  clearAnchor: () => set({ anchor: null }),
}))
