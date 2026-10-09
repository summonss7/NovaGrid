import { useEffect, useRef, useState } from 'react'
import { type AssistInfo, type AssistSuggestion, applySuggestion, computeAssist } from '../formula/assist'

/*
 * Состояние подсказок формул (4.4): каретка, выбранный пункт, «скрыто Esc».
 * Используется строкой формул и редактором ячейки — попап рисует AssistPopup.
 */

export interface AssistUi {
  assist: AssistInfo | null
  activeIdx: number
  /** применить выбранную подсказку к значению */
  pick: (suggestion: AssistSuggestion) => void
  move: (delta: number) => void
  /** клавиши попапа; true — событие обработано (нужно preventDefault) */
  handleKeys: (key: string) => boolean
  /** синхронизация после правки текста/каретки */
  sync: (caret: number) => void
}

export function useFormulaAssist(
  value: string,
  onApply: (next: { value: string; caret: number }) => void,
): AssistUi {
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  // пользователь выбирал пункт стрелками — тогда и Enter подставит его;
  // без навигации Enter фиксирует формулу (как в Excel при дописанном имени)
  const moved = useRef(false)

  // новое слово — список подсказок другой, выбор сбрасывается
  const prefix = value.slice(0, caret)
  const lastWord = prefix.match(/[A-Za-zА-Яа-яЁё0-9_.]*$/)?.[0] ?? ''
  const prevWord = useRef('')
  useEffect(() => {
    if (prevWord.current !== lastWord) {
      prevWord.current = lastWord
      setActiveIdx(0)
    }
  }, [lastWord])

  const assist = dismissed ? null : compute()
  function compute(): AssistInfo | null {
    return computeAssistSafe(value, caret)
  }

  const pick = (suggestion: AssistSuggestion) => {
    const info = compute()
    if (!info) return
    onApply(applySuggestion(value, info.prefixStart, info.prefixEnd, suggestion.name))
    setDismissed(false)
  }

  const move = (delta: number) => {
    const len = assist?.suggestions.length ?? 0
    if (len === 0) return
    moved.current = true
    setActiveIdx((i) => (i + delta + len) % len)
  }

  const handleKeys = (key: string): boolean => {
    if (!assist) return false
    const hasSuggestions = assist.suggestions.length > 0
    if (key === 'Escape') {
      setDismissed(true)
      return true
    }
    if (!hasSuggestions) return false
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      move(key === 'ArrowDown' ? 1 : -1)
      return true
    }
    if (key === 'Tab' || (key === 'Enter' && moved.current)) {
      pick(assist.suggestions[activeIdx % assist.suggestions.length])
      return true
    }
    return false
  }

  const sync = (nextCaret: number) => {
    setCaret(nextCaret)
    setDismissed(false)
    moved.current = false
  }

  return { assist, activeIdx, pick, move, handleKeys, sync }
}

function computeAssistSafe(value: string, caret: number): AssistInfo | null {
  try {
    return computeAssist(value, caret)
  } catch {
    return null
  }
}
