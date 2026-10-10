# NovaGrid — Lighthouse-отчёт (КТ-4: PWA ≥ 90)

Дата: 2026-10-10 · Карточка [novagrid-012](../CARDS/012-Lighthouse-PWA--90-КТ-4-автоматизируемая-часть.md)
(хвост Этапа 5, автоматизируемая часть КТ-4 из [ROADMAP.md](../ROADMAP.md)).

## Итог

| Категория | Mobile | Desktop | Требование |
|---|---|---|---|
| **PWA** | **100** | **100** | ≥ 90 — ✅ с запасом |
| Performance (попутно) | 92 | 100 | — |
| Best Practices (попутно) | 100 | 100 | — |

**PWA 100/100 на обоих профилях с первого прогона — фиксы не потребовались.**
Типовые причины провала КТ-4 были закрыты ещё в Этапе 5: maskable-иконка 512
(`icons/pwa-512-maskable.png`), `theme_color` в манифесте + `<meta name="theme-color">`,
`apple-touch-icon`, корректный `viewport`, офлайн-ответ 200 через precache
service-воркера (20 файлов) и splash-конфигурация из манифеста.

## Методика

- Сборка: `npm run build` (production, precache 20 файлов) → `npm run preview`
  (http://localhost:4173).
- Браузер: Playwright Chromium 1243 (Chrome 153), `CHROME_PATH`; Windows 10,
  Node 24, троттлинг LH по умолчанию (`simulate`).
- Инструментальная особенность 2026 года: категория **PWA удалена из Lighthouse 12+**
  (аудитов в ядре 13.x больше нет). Поэтому:
  - **PWA** снят **Lighthouse 11.7.1** — последней версией с категорией. Прогон
    `--only-categories=pwa` не использует трассировку, поэтому несовместимость
    старого LH с новым Chrome (изменение формата трейса в Chrome 128+) не применима;
  - **Performance / Best Practices** сняты актуальным **Lighthouse 13.5.0**,
    который с Chrome 153 работает штатно.
- Команды (PWA): `npx lighthouse@11.7.1 http://localhost:4173 --only-categories=pwa
  --form-factor=mobile --view=false --output=json` (desktop: `--preset=desktop`).
- JSON-отчёты: [docs/lighthouse/](lighthouse/) — `lighthouse-{mobile,desktop}-{pwa,perf}.json`.

## PWA-аудиты (оба профиля)

| Аудит | Mobile | Desktop |
|---|---|---|
| `installable-manifest` — манифест + SW удовлетворяют требованиям установки (вес 2) | ✅ | ✅ |
| `viewport` — meta-viewport с width/initial-scale (вес 2) | ✅ | ✅ |
| `splash-screen` — конфигурация splash-экрана | ✅ | ✅ |
| `themed-omnibox` — theme-color адресной строки | ✅ | ✅ |
| `maskable-icon` — маскируемая иконка в манифесте | ✅ | ✅ |
| `content-width` — контент по ширине окна | ✅ | N/A (десктоп) |
| `pwa-cross-browser` / `pwa-page-transitions` / `pwa-each-page-has-url` | ручные (вес 0) | ручные (вес 0) |

Ручные аудиты (вес 0, на скор не влияют) по смыслу и есть остаток КТ-4 за
владельцем: проверка на живых устройствах — карточка
[009](../CARDS/009-NovaGrid-Этап-5-PWA-и-мобильные-по-docs-CREATION.md)
(Android Chrome, iPad Safari: установка на домашний экран, офлайн-запуск).

## Performance (попутно, Lighthouse 13.5.0)

| Метрика | Mobile | Desktop |
|---|---|---|
| First Contentful Paint | 2.6 s (0.62) | 0.6 s (0.99) |
| Largest Contentful Paint | 2.7 s (0.85) | 0.6 s (1) |
| Total Blocking Time | **0 ms** (1) | **0 ms** (1) |
| Cumulative Layout Shift | 0 (1) | 0.003 (1) |
| Speed Index | 2.6 s (0.97) | 0.6 s (1) |
| Time to Interactive | 2.7 s (0.97) | 0.6 s (1) |

Mobile 92 при эмуляции медленного 4G/CPU×4: единственный заметный вклад —
первая отрисовка (FCP 2.6 s) из-за рендер-блокирующего CSS приложения (31 KB,
единый бандл) и веса главного бандла (129 KB gzip). TBT 0 — интерфейс не
блокируется: тяжёлый парсер ExcelJS+SheetJS (1.3 MB) живёт в IO-воркере вне
критического пути. Десктоп 100/100. Целенаправленная оптимизация загрузки не
входила в КТ-4 и не проводилась (порога нет); если понадобится — это Этап 7
по обратной связи.

Best Practices 100/100 (замечания Lighthouse об unused-JS и дереве сетевых
зависимостей — информационные инсайты, на скор не влияют).

## Проверки после прогона

Код не менялся (фиксы не потребовались), поэтому полная матрица e2e локально
не гналась — она прогоняется CI на закоммиченном пуше (см. журнал карточки).
Быстрые проверки на этом же дереве: **lint ✓ · typecheck ✓ · 166 юнит ✓ ·
build ✓** (precache 20 файлов).
