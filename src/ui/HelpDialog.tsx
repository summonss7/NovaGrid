import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { X } from 'lucide-react'
import { gridStore } from '../core/store'
import { FUNCTIONS, fnSignature } from '../formula/functions'
import { liveExample } from '../formula/example'
import { useT } from '../i18n'
import { isTauriMobile } from '../io/mobile'
import { useUpdaterStore } from '../io/updater'

/*
 * Справочник «?» (Этап 4.5, Ф6): карточки формул — имя, сигнатура,
 * описание и живой пример, посчитанный движком на текущей таблице
 * (пустому листу служит встроенная мини-таблица). Плюс горячие клавиши
 * и приёмы («как отфильтровать по двум колонкам»). Esc/фон/✕ закрывают.
 */

type Tab = 'fn' | 'keys' | 'how'

const SHORTCUTS: readonly (readonly [string, string])[] = [
  ['Ctrl+F', 'Поиск по листу и по всем листам'],
  ['F3 / Enter', 'Следующее совпадение поиска'],
  ['Ctrl+S / Ctrl+Shift+S', 'Сохранить / Сохранить как…'],
  ['Ctrl+P', 'Печать таблицы'],
  ['Ctrl+O', 'Открыть файл'],
  ['Ctrl+Z / Ctrl+Y', 'Отменить / вернуть'],
  ['Ctrl+B / Ctrl+I / Ctrl+U', 'Жирный / курсив / подчёркнутый всему выделению (панель над таблицей: шрифт, размер, цвет текста и заливки)'],
  ['Панель / ПКМ → «Объединить ячейки»', 'Объединение выделенного блока: значение остаётся в левом верхнем угле (при потере данных — вопрос), «Отменить объединение» возвращает ячейки, Ctrl+Z откатывает'],
  ['Ctrl+A', 'Выделить всё'],
  ['Shift+стрелки', 'Растянуть/сжать выделение (якорь — активная ячейка)'],
  ['Ctrl+C', 'Скопировать выделенный диапазон в буфер (колонки — табы)'],
  ['Ctrl+X', 'Вырезать выделение (блок в буфер, ячейки очищаются)'],
  ['Ctrl+V', 'Вставить из буфера блоком от активной ячейки (Excel/Таблицы/другая книга NovaGrid)'],
  ['F2', 'Править ячейку (каретка в конец)'],
  ['Tab / Enter / Shift+Enter', 'Навигация после правки'],
  ['Ctrl+стрелки', 'Прыжок к краю серии данных'],
  ['Ctrl+Home / Ctrl+End', 'Начало таблицы (A1) / последняя ячейка — быстрый путь к концу данных'],
  ['PageUp / PageDown', 'Листать таблицу по страницам'],
  ['Delete', 'Очистить выделенные ячейки'],
  ['Alt+перетаскивание', 'Живая Σ у курсора (быстрая сумма)'],
  ['Σ (кнопка)', 'Автосумма: нажмите и выделите ячейки — вставится =СУММ'],
  ['Клик по ячейке при вводе «=»', 'Вставить её адрес в формулу (протяжка — диапазон)'],
  ['Граница в шапке колонки', 'Перетащить — изменить ширину колонки'],
  ['ПКМ по ячейке', 'Вырезать / копировать / вставить / удалить + фильтровать / исключить'],
  ['▾ в заголовке колонки', 'Сортировка, галочки значений'],
  ['Esc', 'Закрыть панель / снять выделение'],
]

const TIPS: readonly { title: string; body: string }[] = [
  {
    title: 'Отфильтровать по двум колонкам',
    body: 'ПКМ по «Иванов» в колонке A → «Фильтровать», затем ПКМ по «10000» в C → «Фильтровать». Фильтры объединяются по «И»: остаются строки, подходящие обоим. Чипы под тулбаром показывают активные — клик снимает. Программа помнит, где вы стояли до фильтрации: снятие последнего фильтра вернёт курсор на ту же строку.',
  },
  {
    title: 'Сумма отфильтрованных',
    body: 'Выделите диапазон — Σ, n и среднее появятся в статус-баре (скрытые фильтром строки не считаются). Формулой — =SUMIF(A:A;"Иванов";C:C): пересчитывается при каждой правке.',
  },
  {
    title: 'Формулы: как писать',
    body: 'Начните ячейку с «=». Адреса можно не набирать: клик по ячейке вставляет её ссылку, протяжка мышью — диапазон (работает и в строке формул). Аргументы разделяйте «;» (или «,» — запятая тогда останется десятичной: 1,5). Диапазон A2:A501 пишется и руками, A:A — вся колонка. Пока пишете — подсказки имён и аргументов; ошибка покажется человеческим языком прямо в ячейке.',
  },
  {
    title: 'Сумма одной кнопкой (автосумма Σ)',
    body: 'Встаньте на пустую ячейку, нажмите Σ в тулбаре (на мобильном — в нижней панели) и выделите ячейки мышью или касанием: несмежные области добавляются через Ctrl. Отпустите — в ячейку вставится =СУММ(...) и посчитается; Esc отменяет. Стрелками с Shift — выделение с клавиатуры, Enter применяет.',
  },
  {
    title: 'Чужие формулы (∛)',
    body: 'Если в открытом файле формула с функцией, которую NovaGrid пока не считает, ячейка покажет последнее вычисленное значение с меткой ∛ «не пересчитывается» — и сохранится как есть, без потерь.',
  },
  {
    title: 'Что уезжает в файл при сохранении',
    body: 'В .xlsx пишется всё оформление: шрифт и размер, жирный/курсив/подчёрк, цвет текста и заливки, выравнивание, перенос текста, формат числа, границы, объединения, ширины колонок и закрепление областей — повторное открытие файла в NovaGrid или Excel всё восстанавливает. В .ods пишется то же самое своим генератором; ограничения формата: закрепление понимает LibreOffice (Excel его из .ods не читает), из форматов числа — только «числовой/валютный/процентный», гарнитуры сохраняются именами (Open Sans, Montserrat должны быть установлены). .csv всегда только значения активного листа без оформления.',
  },
  {
    title: 'Перенос книги через облако (.nvgridx)',
    body: '«Сохранить как…» → формат .nvgridx — вся книга уедет в один зашифрованный файл (AES-GCM): положите его в любую облачную папку, провайдер увидит только шифротекст. На другом устройстве откройте файл NovaGrid и введите ту же парольную фразу. Забытая фраза — данные не восстановить; при конфликте версий облако оставит копию, побеждает последняя.',
  },
  {
    title: 'Быстрая сумма без формулы',
    body: 'Зажмите Alt и протяните по ячейкам — оранжевая рамка и крупная Σ у курсора посчитают сумму на лету; отпустите — выделение вернётся.',
  },
  {
    title: 'Правки не теряются при закрытии',
    body: 'Закрытие окна (вкладки) с несохранённой книгой спросит подтверждение: «Сохранить / Не сохранять / Отмена» — в браузере это системный вопрос «покинуть сайт?». Плюс сессия правок автосохраняется локально: после случайного закрытия книга возвращается кнопкой «Продолжить» на стартовом экране.',
  },
  {
    title: 'Настроить интерфейс под себя',
    body: 'Кнопка-глаз («Вид») в тулбаре: галочки показывают/скрывают панели — форматирование, строку формул, фильтры, список листов, статус-бар (меню остаётся открытым, чтобы снять несколько галочек подряд). Там же вкладки листов «Рядами»: у книг с десятками листов все вкладки раскладываются по ширине окна в несколько рядов — не нужно тянуть ползунок вправо, все ряды остаются в видимой зоне внизу. Переключатель «один ряд / рядами» есть и прямо на панели вкладок — две кнопки-иконки сразу после «+». Настройки сохраняются между запусками.',
  },
]

export function HelpDialog(props: { onClose: () => void }) {
  const t = useT()
  const [tab, setTab] = useState<Tab>('fn')
  const [query, setQuery] = useState('')
  const closeRef = useRef<HTMLButtonElement>(null)
  const sheet = useStore(gridStore, (s) => s.sheet)

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  const cards = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...FUNCTIONS.values()]
      .filter((d) => d.meta.name !== 'CONCATENATE')
      .filter((d) => {
        if (!q) return true
        return (
          d.meta.name.toLowerCase().includes(q) || d.meta.desc.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => a.meta.group.localeCompare(b.meta.group, 'ru') || a.meta.name.localeCompare(b.meta.name, 'ru'))
      .map((d) => {
        // живой пример считается на текущем листе (мемо на имя+лист)
        const example = liveExample(sheet, d.meta.name)
        return { meta: d.meta, sig: fnSignature(d.meta), example }
      })
  }, [query, sheet])

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.currentTarget === e.target) props.onClose()
      }}
    >
      <div className="help-dialog" role="dialog" aria-modal="true" aria-label={t.helpTitle}>
        <header className="help-header">
          <h2>{t.helpTitle}</h2>
          <div className="help-tabs" role="tablist" aria-label={t.helpTitle}>
            {(
              [
                ['fn', t.helpTabFunctions],
                ['keys', t.helpTabKeys],
                ['how', t.helpTabHow],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`help-tab${tab === id ? ' help-tab-active' : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label={t.helpClose}
            onClick={props.onClose}
          >
            <X size={18} strokeWidth={1.5} aria-hidden />
          </button>
        </header>

        {tab === 'fn' && (
          <div className="help-body">
            <input
              className="help-search"
              type="search"
              placeholder={t.helpSearchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t.helpSearchPlaceholder}
            />
            {cards.length === 0 && <p className="help-empty">{t.searchNoMatches}</p>}
            <div className="help-cards">
              {cards.map((c) => (
                <article key={c.meta.name} className="help-card">
                  <h3 className="help-card-name">{c.meta.name}</h3>
                  <code className="help-card-sig">{c.sig}</code>
                  <p className="help-card-desc">{c.meta.desc}</p>
                  <p className="help-card-example">
                    {t.helpExampleLabel}:{' '}
                    <code>{c.example.formula}</code>
                    <span className="help-card-result"> → {c.example.result}</span>
                  </p>
                </article>
              ))}
            </div>
          </div>
        )}

        {tab === 'keys' && (
          <div className="help-body">
            <table className="help-keys">
              <thead>
                <tr>
                  <th>{t.helpKeysColKey}</th>
                  <th>{t.helpKeysColAction}</th>
                </tr>
              </thead>
              <tbody>
                {SHORTCUTS.map(([key, action]) => (
                  <tr key={key}>
                    <td>
                      <kbd>{key}</kbd>
                    </td>
                    <td>{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'how' && (
          <div className="help-body">
            <div className="help-tips">
              {TIPS.map((t) => (
                <article key={t.title} className="help-tip">
                  <h3>{t.title}</h3>
                  <p>{t.body}</p>
                </article>
              ))}
            </div>
          </div>
        )}

        {/* мобильная обёртка Android (novagrid-063): пункта меню «Справка →
            Проверить обновления…» нет — кнопка здесь, открывает тот же
            диалог OTA (manual-проверка показывает любой исход) */}
        {isTauriMobile() && (
          <footer className="help-footer">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                props.onClose()
                void useUpdaterStore.getState().check(true)
              }}
            >
              ⬆ {t.helpCheckUpdate}
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}
