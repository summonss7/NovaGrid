# Десктоп-обёртка NovaGrid (Этап 7.5, карточка novagrid-018)

Нативная оболочка **Tauri 2** поверх веб-приложения: значок в меню «Пуск»,
нативное меню «Файл», диалоги открытия/сохранения и файловые ассоциации
.xlsx/.xls/.ods/.csv без браузера. Веб-часть не меняется — обёртка грузит ту же
production-сборку (`dist/`), что и PWA; в браузере/PWA всё работает как раньше.

## Что внутри

| Путь | Роль |
|---|---|
| `desktop/` | Rust-каркас Tauri: `src/main.rs` (окно, меню, IPC-команды), `tauri.conf.json` (окно 1280×800, мин. 960×600, иконки, CSP), `Cargo.toml`, `installer.iss` (Inno Setup), `icons/` (знак приложения), `lib/WebView2Loader.dll` |
| `scripts/desktop-build.sh` | Сборка: фронтенд → exe (frontend внутри) → портабельная папка+zip в `builds/` → установщик Inno Setup в `builds/` (release) → автообновление развёрнутой копии `C:\NovaGrid` (release) |
| `scripts/deploy-portable.sh` | Обновление развёрнутой портативной копии в `C:\NovaGrid` (novagrid-021): копирует exe+DLL из портабельной сборки и сверяет md5; вызывается релизной desktop-build.sh и годится для ручного запуска |
| `scripts/desktop-dev.sh` | Dev-режим: vite devserver :5173 + `cargo run` без встраивания (окно грузит dev-сервер, HMR живой) |
| `scripts/make-desktop-icons.mjs` | Иконки из `public/favicon.svg` (растеризация playwright-chromium, многослойный .ico); перегенерация лишь при смене знака — иконки закоммичены |
| `src/io/desktop.ts` | Мост фронтенда: всё за `isDesktop()` (признак `window.__TAURI__`), браузерная сборка ни одного вызова не выполняет; npm-пакеты `@tauri-apps` сознательно не подключаются |

Интеграция в `App.tsx`: нативный «Файл → Открыть» → тот же конвейер `openFile`;
`Ctrl+S` — прямая запись по пути (`desktopPath` в сторе — аналог FSA-хэндла);
«Сохранить как…» — нативный диалог; книга из аргумента запуска открывается
на старте; нативное меню шлёт события `novagrid:menu` тем же обработчикам;
service worker в обёртке не регистрируется (контент уже в exe).

## Пререквизиты (Windows)

На машине сборки (этой) стоит и проверено:

1. **Node.js 24** (та же, что для веб-части) — `npm ci`.
2. **Rust** через rustup, тулчейн **GNU**: `rustup toolchain install stable-x86_64-pc-windows-gnu`.
   GNU, а не MSVC: среда не тянет VS Build Tools; MSYS2 даёт gcc/dlltool.
3. **MSYS2** (ucrt64): `C:\Users\<user>\msys64\ucrt64\bin` — gcc/линкер для GNU-тулчейна; скрипты добавляют его в PATH сами.
4. **WebView2Loader.dll** — уже в репозитории (`desktop/lib/`); линкуется напрямую
   (мингвский ld читает экспорты DLL, `.cargo/config.toml` ведёт `-L native` туда),
   тот же DLL кладётся рядом с exe в сборках. Сам WebView2 — системный Evergreen,
   на Windows 10/11 уже есть.
5. **Inno Setup 6** (только для установщика, per-user): `winget install --id JRSoftware.InnoSetup --scope user`.
   Нет — скрипт честно соберёт только портабельную сборку.

Ограничение версии: `tauri = "=2.12.1"` — 2.12.3+ тянет из loader-архива MSVC-объекты
с зависимостями от MSVC-CRT, которые не собираются GNU-тулчейном (подробности —
комментарии в `desktop/Cargo.toml` и `desktop/.cargo/config.toml`).

## Команды

```bash
npm run desktop:icons   # перегенерация иконок (только при смене знака)
npm run desktop:dev     # окно + vite devserver (HMR)
npm run desktop:build           # release: dist/ → exe → builds/novagrid-<ver>-portable-release(.zip) → setup.exe → обновить C:\NovaGrid
npm run desktop:build debug     # debug: только портабельная папка+zip
scripts/deploy-portable.sh      # вручную обновить C:\NovaGrid (по умолчанию — свежая release-папка текущей версии)
```

Версия берётся из `package.json` (единый источник с веб-приложением), тип —
суффиксом в имени артефакта:

- `builds/novagrid-1.5.0-setup-release.exe` — установщик (пер-пользовательский,
  без UAC: `%LOCALAPPDATA%\Programs\NovaGrid`; ярлыки «Пуск»/рабочий стол;
  чекбокс файловых ассоциаций);
- `builds/novagrid-1.5.0-portable-release/` (+ `.zip`) — exe + WebView2Loader.dll,
  запускается без установки.

`builds/` и `desktop/target/` в `.gitignore` — артефакты в git не попадают.

## Развёрнутая копия C:\NovaGrid

На машине владельца развёрнута портативная копия приложения: `C:\NovaGrid\NovaGrid.exe`
+ `WebView2Loader.dll` — папка на диске C:, вне репозитория. Правило проекта
(карточка novagrid-021, 12.10.2026): **при выпуске каждой новой версии эта копия
обновляется автоматически** — без отдельной просьбы владельца.

- Механизм: `desktop-build.sh` (release) в конце сборки вызывает
  `scripts/deploy-portable.sh` — exe и DLL копируются из свежей
  `builds/novagrid-<версия>-portable-release/`, совпадение exe проверяется md5.
- Вручную (догнать пропущенный релиз): `scripts/deploy-portable.sh` — без
  аргументов возьмёт папку текущей версии из `package.json`; можно передать
  путь к конкретной портабельной папке.
- Края: папки `C:\NovaGrid` нет — скрипт сообщит и завершится без ошибки
  (машина без развёрнутой копии); exe запущен — копирование упадёт «file in
  use»: закрыть окно NovaGrid и повторить.

## Файловые ассоциации

Inno Setup (`desktop/installer.iss`) регистрирует ProgId `NovaGrid.Book`
и добавляет NovaGrid в «Открыть с помощью» для `.xlsx/.xls/.ods/.csv`
(`OpenWithProgids`, HKCU). Владелец по умолчанию (Excel/LibreOffice)
**не перехватывается** — пользователь назначает NovaGrid приложением по
умолчанию сам, если хочет. Открытие: Explorer запускает
`NovaGrid.exe "<путь к книге>"` — аргумент читается на старте ( IPC
`startup_book`, однократно) и книга открывается тем же конвейером, что
и drag-and-drop в веб-версии.

## Проверка (смоук)

Ручной смоук на машине сборки (результаты — в CHANGELOG этапа):

1. Запуск портабельного exe с аргументом-книгой: окно открывается, книга
   загружена (данные, вкладки, Σ) — путь ассоциаций.
2. «Файл → Открыть…» (нативный диалог rfd) — книга открывается;
   «Файл → Сохранить как…» — файл по выбранному пути перечитывается.
3. Установщик: тихая установка per-user, ярлык запускает приложение,
   деинсталлятор убирает ассоциации.

## Capacitor (Android)

По плану Этапа 7.5 — только если Tauri-ветка закрыта быстро и Android-база
уже стоит. В этой сессии не собиралась: Tauri-ветка закрыла этап, отдельной
инструментальной базы Android под установщик не выделялось. Документируется
здесь, чтобы следующая итерация знала входную точку: PWA уже проходит
Lighthouse PWA 100/100 mobile ([LIGHTHOUSE-REPORT](LIGHTHOUSE-REPORT.md)),
Capacitor-обёртка — отдельная карточка при появлении запроса.
