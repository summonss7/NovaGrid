; NovaGrid — Inno Setup script (Этап 7.5, карточка novagrid-018).
;
; Per-user install: %LOCALAPPDATA%\Programs\NovaGrid, no UAC.
; Файловые ассоциации — вежливые: NovaGrid добавляется в «Открыть с помощью»
; для .xlsx/.xls/.ods/.csv/.nvgridx (OpenWithProgids), владелец по умолчанию
; (Excel/LibreOffice) не перехватывается — пользователь назначает сам.
;
; Версия/тип передаются из scripts/desktop-build.sh:
;   ISCC /DAppVersion=1.5.0 /DType=release /O<builddir> desktop/installer.iss

#ifndef AppVersion
#define AppVersion "0.0.0"
#endif
#ifndef Type
#define Type "release"
#endif

[Setup]
AppId={{7E4B2C91-9A3F-4D68-B5E1-8C0F2A94D6A7}
AppName=NovaGrid
AppVersion={#AppVersion}
AppPublisher=NovaGrid
AppPublisherURL=https://github.com/summonss7/NovaGrid
AppUpdatesURL=https://github.com/summonss7/NovaGrid/releases
UninstallDisplayName=NovaGrid {#AppVersion}
UninstallDisplayIcon={app}\NovaGrid.exe
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\NovaGrid
DefaultGroupName=NovaGrid
DisableProgramGroupPage=yes
OutputBaseFilename=novagrid-{#AppVersion}-setup-{#Type}
OutputDir=..\builds
SetupIconFile=icons\icon.ico
VersionInfoVersion={#AppVersion}
; после установки/удаления Explorer обновит значки и меню «Открыть с помощью»
ChangesAssociations=yes
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
; exe + WebView2Loader.dll (сам GNU-рантайм статичен, WebView2 — системный
; компонент Evergreen)
CloseApplications=no

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "fileassoc"; Description: "Добавить NovaGrid в «Открыть с помощью» для .xlsx, .xls, .ods, .csv и .nvgridx"; GroupDescription: "Файловые ассоциации:"

[Files]
Source: "target\release\novagrid.exe"; DestDir: "{app}"; DestName: "NovaGrid.exe"; Flags: ignoreversion
; загрузчик WebView2: exe линкуется с ним напрямую (см. desktop/.cargo/config.toml)
Source: "lib\WebView2Loader.dll"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\NovaGrid"; Filename: "{app}\NovaGrid.exe"; WorkingDir: "{app}"
Name: "{group}\{cm:UninstallProgram,NovaGrid}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\NovaGrid"; Filename: "{app}\NovaGrid.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
; ProgId «книга таблиц NovaGrid»: значок и команда запуска с аргументом-путём
Root: HKCU; Subkey: "Software\Classes\NovaGrid.Book"; ValueType: string; ValueName: ""; ValueData: "Книга таблиц NovaGrid"; Flags: uninsdeletekey; Tasks: fileassoc
Root: HKCU; Subkey: "Software\Classes\NovaGrid.Book\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\NovaGrid.exe,0"; Flags: uninsdeletekey; Tasks: fileassoc
Root: HKCU; Subkey: "Software\Classes\NovaGrid.Book\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\NovaGrid.exe"" ""%1"""; Flags: uninsdeletekey; Tasks: fileassoc
; точки входа расширений: NovaGrid появляется в «Открыть с помощью»,
; дефолт не трогаем — владелец остаётся, пользователь меняет сам при желании
Root: HKCU; Subkey: "Software\Classes\.xlsx\OpenWithProgids"; ValueType: string; ValueName: "NovaGrid.Book"; ValueData: ""; Flags: uninsdeletevalue; Tasks: fileassoc
Root: HKCU; Subkey: "Software\Classes\.xls\OpenWithProgids"; ValueType: string; ValueName: "NovaGrid.Book"; ValueData: ""; Flags: uninsdeletevalue; Tasks: fileassoc
Root: HKCU; Subkey: "Software\Classes\.ods\OpenWithProgids"; ValueType: string; ValueName: "NovaGrid.Book"; ValueData: ""; Flags: uninsdeletevalue; Tasks: fileassoc
Root: HKCU; Subkey: "Software\Classes\.csv\OpenWithProgids"; ValueType: string; ValueName: "NovaGrid.Book"; ValueData: ""; Flags: uninsdeletevalue; Tasks: fileassoc
; .nvgridx — зашифрованный снапшот книги (Этап 7.6): двойной клик в облачной
; папке открывает капсулу, фразу спросит приложение
Root: HKCU; Subkey: "Software\Classes\.nvgridx\OpenWithProgids"; ValueType: string; ValueName: "NovaGrid.Book"; ValueData: ""; Flags: uninsdeletevalue; Tasks: fileassoc

[Run]
Filename: "{app}\NovaGrid.exe"; WorkingDir: "{app}"; Description: "{cm:LaunchProgram,NovaGrid}"; Flags: nowait postinstall skipifsilent
