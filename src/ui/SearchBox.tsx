import { ChevronDown, ChevronUp, Replace, Search, Settings, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { gridStore } from '../core/store'
import { cellRefName } from '../grid/geometry'
import { getCell } from '../core/sheet'
import { useT } from '../i18n'

/** Сколько совпадений показывать в списке «Все листы» (дальше — счётчик). */
const RESULTS_CAP = 60

/**
 * Поле поиска тулбара (CONCEPT Ф2, DESIGN-SYSTEM §8): инкрементальный поиск
 * с разворачиваемой панелью — переключатель «Этот лист / Все листы», счётчик
 * «12 / 47», навигация ▲▼/Enter/Shift+Enter/F3, параметры (регистр, ячейка
 * целиком). В режиме «Все листы» — сгруппированный список результатов.
 */
export function SearchBox() {
  const t = useT()
  const search = useStore(gridStore, (s) => s.search)
  const tabs = useStore(gridStore, (s) => s.tabs)
  const inputRef = useRef<HTMLInputElement>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)

  // Ctrl+F открывает поиск из любого места книги; Esc закрывает, где бы ни
  // был фокус (поле, список результатов, сама панель)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.code === 'KeyF') {
        e.preventDefault()
        gridStore.getState().openSearch()
      } else if (e.key === 'Escape' && gridStore.getState().search.open) {
        gridStore.getState().closeSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (search.open) {
      inputRef.current?.focus({ preventScroll: true })
      inputRef.current?.select()
    }
  }, [search.open])

  const counter =
    search.query === ''
      ? ''
      : search.hits.length > 0
        ? `${search.index + 1} / ${search.hits.length}`
        : `0 / 0`

  const results =
    search.scope === 'book' && search.query !== '' && search.hits.length > 0
      ? search.hits.slice(0, RESULTS_CAP)
      : []
  const moreResults = Math.max(0, search.hits.length - results.length)

  return (
    <div className={`search-wrap${search.open ? ' is-open' : ''}`}>
      <div className="search">
        <Search size={15} strokeWidth={1.5} aria-hidden />
        <input
          ref={inputRef}
          type="search"
          className="search-input"
          placeholder={t.searchPlaceholder}
          aria-label={t.searchLabel}
          value={search.query}
          onChange={(e) => gridStore.getState().setSearchQuery(e.target.value)}
          onFocus={() => gridStore.getState().openSearch()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              gridStore.getState().searchStep(e.shiftKey ? -1 : 1)
              e.preventDefault()
            } else if (e.key === 'F3') {
              gridStore.getState().searchStep(e.shiftKey ? -1 : 1)
              e.preventDefault()
            } else if (e.key === 'Escape') {
              gridStore.getState().closeSearch()
              e.preventDefault()
            }
          }}
        />
        <kbd className="search-kbd">{t.searchHint}</kbd>
      </div>

      {search.open && (
        <div className="search-panel" role="dialog" aria-label={t.searchResultsLabel}>
          <div className="search-panel-row">
            <div className="search-scope" role="radiogroup" aria-label={t.searchScopeLabel}>
              <button
                type="button"
                role="radio"
                aria-checked={search.scope === 'sheet'}
                className={
                  search.scope === 'sheet' ? 'search-scope-btn is-active' : 'search-scope-btn'
                }
                onClick={() => gridStore.getState().setSearchScope('sheet')}
              >
                {t.searchScopeSheet}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={search.scope === 'book'}
                className={
                  search.scope === 'book' ? 'search-scope-btn is-active' : 'search-scope-btn'
                }
                onClick={() => gridStore.getState().setSearchScope('book')}
              >
                {t.searchScopeBook}
              </button>
            </div>
            <span className="search-counter" aria-live="polite">
              {counter}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-xs"
              aria-label={t.searchPrev}
              title={t.searchPrev}
              onClick={() => gridStore.getState().searchStep(-1)}
            >
              <ChevronUp size={15} strokeWidth={1.5} aria-hidden />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-xs"
              aria-label={t.searchNext}
              title={t.searchNext}
              onClick={() => gridStore.getState().searchStep(1)}
            >
              <ChevronDown size={15} strokeWidth={1.5} aria-hidden />
            </button>
            <button
              type="button"
              className={`btn btn-ghost btn-icon btn-xs${optionsOpen ? ' is-active' : ''}`}
              aria-label={t.searchOptions}
              aria-expanded={optionsOpen}
              title={t.searchOptions}
              onClick={() => setOptionsOpen((v) => !v)}
            >
              <Settings size={15} strokeWidth={1.5} aria-hidden />
            </button>
            {/* Этап 7: Ctrl+H из панели поиска — запрос наследуется диалогом */}
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-xs"
              aria-label={t.replaceOpenAction}
              title={`${t.replaceOpenAction} (${t.replaceHint})`}
              onClick={() => gridStore.getState().openReplace()}
            >
              <Replace size={15} strokeWidth={1.5} aria-hidden />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-xs"
              aria-label={t.searchClose}
              title={t.searchClose}
              onClick={() => gridStore.getState().closeSearch()}
            >
              <X size={15} strokeWidth={1.5} aria-hidden />
            </button>
          </div>

          {optionsOpen && (
            <div className="search-options">
              <label>
                <input
                  type="checkbox"
                  checked={search.caseSensitive}
                  onChange={(e) =>
                    gridStore.getState().setSearchOptions({ caseSensitive: e.target.checked })
                  }
                />
                {t.searchCaseSensitive}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={search.wholeCell}
                  onChange={(e) =>
                    gridStore.getState().setSearchOptions({ wholeCell: e.target.checked })
                  }
                />
                {t.searchWholeCell}
              </label>
            </div>
          )}

          {search.scope === 'book' && search.query !== '' && (
            <div className="search-results" aria-label={t.searchResultsLabel}>
              {results.length === 0 && (
                <div className="search-results-empty">{t.searchNoMatches}</div>
              )}
              {tabs.map((tab, tabIndex) => {
                const items = results.filter((h) => h.tab === tabIndex)
                if (items.length === 0) return null
                return (
                  <div key={tab.id} className="search-group">
                    <div className="search-group-title">{tab.name}</div>
                    {items.map((h) => (
                      <SearchResultRow key={`${h.tab}:${h.row}:${h.col}`} hit={h} />
                    ))}
                  </div>
                )
              })}
              {moreResults > 0 && (
                <div className="search-results-more">{t.searchMoreResults(moreResults)}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Пункт результата: адрес ячейки + её значение (клик — переход). */
function SearchResultRow(props: { hit: { tab: number; row: number; col: number } }) {
  const t = useT()
  const { hit } = props
  const value = useStore(gridStore, (s) =>
    getCell(s.tabs[hit.tab]?.sheet ?? s.sheet, hit.row, hit.col),
  )
  return (
    <button
      type="button"
      className="search-result"
      onClick={() => gridStore.getState().gotoHit(hit)}
    >
      <span className="search-result-ref">{cellRefName(hit.row, hit.col)}</span>
      <span className="search-result-text">{value === '' ? t.filterBlanks : value}</span>
    </button>
  )
}
