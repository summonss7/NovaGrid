import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Eraser,
  Italic,
  PaintBucket,
  TableCellsMerge,
  TableCellsSplit,
  Underline,
} from 'lucide-react'
import { useState } from 'react'
import { useStore } from 'zustand'
import { mergeLosesData } from '../core/merges'
import { normalize } from '../core/selection'
import { CELL_SIZE_MAX, CELL_SIZE_MIN, cellKey, type CellFormat } from '../core/sheet'
import { gridStore } from '../core/store'
import { useT } from '../i18n'

/*
 * Панель форматирования ячеек (novagrid-039): шрифт и размер, Ж/К/Ч,
 * цвет текста и заливка — применяется ко всему выделению, откатывается
 * одним Ctrl+Z. Показывает стиль активной ячейки (как лента Excel: Ж
 * нажата, пока активная ячейка жирная). Палитра — ходовые цвета Excel +
 * фирменные NovaGrid; точный цвет — системный пикер «Свой цвет…».
 * Располагается между строкой формул и таблицей (DESIGN-SYSTEM §6).
 */

/** Палитра стандартных цветов: 5 рядов по 6 — нейтральные, тёплые, холодные. */
const PALETTE: readonly string[] = [
  '000000', '404040', '808080', 'BFBFBF', 'FFFFFF', 'F26B21',
  'C00000', 'FF0000', 'FFC000', 'FFFF00', '92D050', '3ADF63',
  '00B050', '00B0F0', '0070C0', '002060', '7030A0', 'FF66CC',
]

/** Размеры шрифта в пунктах (pt): высота строки 30px вмещает до 16pt. */
const SIZES: readonly number[] = [8, 9, 10, 11, 12, 13, 14, 16]

export function FormatBar() {
  const t = useT()
  const [palette, setPalette] = useState<'fg' | 'bg' | null>(null)
  const style = useStore(gridStore, (s) =>
    s.sheet.styles.get(cellKey(s.selection.active.row, s.selection.active.col)),
  )

  // после кнопки фокус возвращается таблице — Ctrl+Z/стрелки работают дальше
  const focusGrid = () => {
    document.querySelector<HTMLElement>('.grid-area')?.focus({ preventScroll: true })
  }
  const apply = (fn: () => void) => () => {
    fn()
    focusGrid()
  }

  const setFont = (font: 'sans' | 'display') =>
    gridStore.getState().applyStyle(font === 'display' ? { font: 'display' } : { font: undefined })

  const setSize = (pt: number | null) =>
    gridStore.getState().applyStyle(
      pt === null
        ? { size: undefined }
        : { size: Math.min(CELL_SIZE_MAX, Math.max(CELL_SIZE_MIN, pt)) },
    )

  // выравнивание (novagrid-045): повторный клик по нажатой — авто (числа справа)
  const setAlign = (a: 'left' | 'center' | 'right') =>
    gridStore.getState().applyStyle(style?.align === a ? { align: undefined } : { align: a })

  // формат числа (novagrid-045): отображение значения, данные не меняются
  const setFmt = (fmt: string) =>
    gridStore.getState().applyStyle(
      fmt === 'general' ? { fmt: undefined } : { fmt: fmt as CellFormat },
    )

  // объединение ячеек (novagrid-047): одна область выделения; при потере
  // данных — предупреждение (как диалог Excel)
  const canMerge = useStore(gridStore, (s) => {
    if (s.selection.ranges.length !== 1) return false
    const n = normalize(s.selection.ranges[0])
    return n.r1 !== n.r2 || n.c1 !== n.c2
  })
  const canUnmerge = useStore(gridStore, (s) =>
    (s.sheet.merges ?? []).some((m) =>
      s.selection.ranges.some((rg) => {
        const n = normalize(rg)
        return m.r1 <= n.r2 && m.r2 >= n.r1 && m.c1 <= n.c2 && m.c2 >= n.c1
      }),
    ),
  )
  const mergeSelection = () => {
    const st = gridStore.getState()
    if (st.selection.ranges.length !== 1) return
    if (
      mergeLosesData(st.sheet, normalize(st.selection.ranges[0])) &&
      !window.confirm(t.mergeLossWarning)
    )
      return
    st.mergeSelection()
  }

  const pickColor = (hex: string) => {
    gridStore.getState().applyStyle(palette === 'fg' ? { fg: hex } : { bg: hex })
    setPalette(null)
  }

  const fgHex = style?.fg ?? '2B2B2B'
  const bgHex = style?.bg ?? null
  const curHex = palette === 'fg' ? fgHex : bgHex

  return (
    <div className="format-bar" role="group" aria-label={t.formatBarLabel}>
      <select
        className="fmt-select"
        aria-label={t.formatFontLabel}
        value={style?.font === 'display' ? 'display' : 'sans'}
        onChange={(e) => {
          setFont(e.target.value as 'sans' | 'display')
          focusGrid()
        }}
      >
        <option value="sans">{t.formatFontSans}</option>
        <option value="display">{t.formatFontDisplay}</option>
      </select>

      <select
        className="fmt-select fmt-select-size"
        aria-label={t.formatSizeLabel}
        value={style?.size !== undefined ? String(style.size) : 'auto'}
        onChange={(e) => {
          const v = e.target.value
          setSize(v === 'auto' ? null : Number(v))
          focusGrid()
        }}
      >
        <option value="auto">{t.formatSizeAuto}</option>
        {SIZES.map((pt) => (
          <option key={pt} value={pt}>
            {t.num(pt)}
          </option>
        ))}
      </select>

      <select
        className="fmt-select"
        aria-label={t.formatNumberLabel}
        title={t.formatNumberLabel}
        value={style?.fmt ?? 'general'}
        onChange={(e) => {
          setFmt(e.target.value)
          focusGrid()
        }}
      >
        <option value="general">{t.formatNumGeneral}</option>
        <option value="number">{t.formatNumNumber}</option>
        <option value="money">{t.formatNumMoney}</option>
        <option value="percent">{t.formatNumPercent}</option>
      </select>

      <span className="fmt-sep" aria-hidden />

      <button
        type="button"
        className={`fmt-btn fmt-toggle${style?.bold ? ' is-on' : ''}`}
        aria-label={t.formatBold}
        title={t.formatBold}
        aria-pressed={style?.bold === true}
        onClick={apply(() => gridStore.getState().toggleStyle('bold'))}
      >
        <Bold size={15} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        className={`fmt-btn fmt-toggle${style?.italic ? ' is-on' : ''}`}
        aria-label={t.formatItalic}
        title={t.formatItalic}
        aria-pressed={style?.italic === true}
        onClick={apply(() => gridStore.getState().toggleStyle('italic'))}
      >
        <Italic size={15} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        className={`fmt-btn fmt-toggle${style?.underline ? ' is-on' : ''}`}
        aria-label={t.formatUnderline}
        title={t.formatUnderline}
        aria-pressed={style?.underline === true}
        onClick={apply(() => gridStore.getState().toggleStyle('underline'))}
      >
        <Underline size={15} strokeWidth={2} aria-hidden />
      </button>

      <button
        type="button"
        className={`fmt-btn fmt-toggle${style?.align === 'left' ? ' is-on' : ''}`}
        aria-label={t.formatAlignLeft}
        title={t.formatAlignLeft}
        aria-pressed={style?.align === 'left'}
        onClick={apply(() => setAlign('left'))}
      >
        <AlignLeft size={15} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        className={`fmt-btn fmt-toggle${style?.align === 'center' ? ' is-on' : ''}`}
        aria-label={t.formatAlignCenter}
        title={t.formatAlignCenter}
        aria-pressed={style?.align === 'center'}
        onClick={apply(() => setAlign('center'))}
      >
        <AlignCenter size={15} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        className={`fmt-btn fmt-toggle${style?.align === 'right' ? ' is-on' : ''}`}
        aria-label={t.formatAlignRight}
        title={t.formatAlignRight}
        aria-pressed={style?.align === 'right'}
        onClick={apply(() => setAlign('right'))}
      >
        <AlignRight size={15} strokeWidth={2} aria-hidden />
      </button>

      <button
        type="button"
        className="fmt-btn"
        aria-label={t.formatMerge}
        title={t.formatMerge}
        disabled={!canMerge}
        onClick={apply(mergeSelection)}
      >
        <TableCellsMerge size={15} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        className="fmt-btn"
        aria-label={t.formatUnmerge}
        title={t.formatUnmerge}
        disabled={!canUnmerge}
        onClick={apply(() => gridStore.getState().unmergeSelection())}
      >
        <TableCellsSplit size={15} strokeWidth={2} aria-hidden />
      </button>

      <span className="fmt-sep" aria-hidden />

      <div className="fmt-color-wrap">
        <button
          type="button"
          className={`fmt-btn${palette === 'fg' ? ' is-on' : ''}`}
          aria-label={t.formatFgColor}
          title={t.formatFgColor}
          aria-haspopup="menu"
          aria-expanded={palette === 'fg'}
          onClick={() => setPalette(palette === 'fg' ? null : 'fg')}
        >
          <Baseline size={15} strokeWidth={2} aria-hidden />
          <span className="fmt-color-chip" style={{ background: `#${fgHex}` }} aria-hidden />
        </button>
      </div>
      <div className="fmt-color-wrap">
        <button
          type="button"
          className={`fmt-btn${palette === 'bg' ? ' is-on' : ''}`}
          aria-label={t.formatBgColor}
          title={t.formatBgColor}
          aria-haspopup="menu"
          aria-expanded={palette === 'bg'}
          onClick={() => setPalette(palette === 'bg' ? null : 'bg')}
        >
          <PaintBucket size={15} strokeWidth={2} aria-hidden />
          {bgHex ? (
            <span className="fmt-color-chip" style={{ background: `#${bgHex}` }} aria-hidden />
          ) : (
            <span className="fmt-color-chip fmt-color-none" aria-hidden />
          )}
        </button>
      </div>

      <button
        type="button"
        className="fmt-btn"
        aria-label={t.formatClear}
        title={t.formatClear}
        onClick={apply(() => gridStore.getState().clearStyle())}
      >
        <Eraser size={15} strokeWidth={2} aria-hidden />
      </button>

      {palette && (
        <>
          <div
            className="menu-backdrop"
            onClick={() => {
              setPalette(null)
              document.querySelector<HTMLElement>('.grid-area')?.focus({ preventScroll: true })
            }}
            aria-hidden
          />
          <div className="fmt-palette" role="menu" aria-label={t.formatPaletteLabel}>
            <button
              type="button"
              role="menuitem"
              className="fmt-reset"
              onClick={() => {
                gridStore.getState().applyStyle(palette === 'fg' ? { fg: undefined } : { bg: undefined })
                setPalette(null)
                document.querySelector<HTMLElement>('.grid-area')?.focus({ preventScroll: true })
              }}
            >
              {palette === 'fg' ? t.formatColorAuto : t.formatNoFill}
            </button>
            <div className="fmt-swatches">
              {PALETTE.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  role="menuitem"
                  className="fmt-swatch"
                  style={{ background: `#${hex}` }}
                  aria-label={`#${hex}`}
                  onClick={apply(() => pickColor(hex))}
                >
                  {hex === curHex && <span className="fmt-swatch-on" aria-hidden />}
                </button>
              ))}
            </div>
            <label className="fmt-custom">
              {t.formatCustomColor}
              <input
                type="color"
                aria-label={t.formatCustomColor}
                value={`#${palette === 'fg' ? fgHex : (bgHex ?? 'FFFFFF')}`}
                onChange={(e) => {
                  // живое применение: цвет видно сразу, палитра остаётся открытой
                  gridStore
                    .getState()
                    .applyStyle(
                      palette === 'fg'
                        ? { fg: e.target.value.slice(1).toUpperCase() }
                        : { bg: e.target.value.slice(1).toUpperCase() },
                    )
                }}
              />
            </label>
          </div>
        </>
      )}
    </div>
  )
}
