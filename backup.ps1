# ============================================================
#  NovaGrid — резервная копия проекта в backups\
#
#  В архив (ZIP): код, документация, карточки CARDS и всё
#  незаменимое вне git (promt.txt, дизайн-макеты).
#  НЕ кладётся: .git, backups/, node_modules/, dist/.
#  После создания архив проверяется на читаемость (tar -tf).
#  Держатся последние 8 архивов, более старые удаляются.
#
#  Восстановление: распаковать ZIP в папку проекта.
#  Запуск: двойным кликом по backup.bat (обёртка над этим файлом).
# ============================================================

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Set-Location -LiteralPath $PSScriptRoot

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
if (-not (Test-Path 'backups')) { New-Item -ItemType Directory -Path 'backups' | Out-Null }
$zip = Join-Path 'backups' ("NovaGrid-backup-" + $stamp + ".zip")

$temp = Join-Path $env:TEMP ("novagrid_backup_" + $stamp)
New-Item -ItemType Directory -Path $temp | Out-Null

# Копируем всё, кроме служебных папок
robocopy $PSScriptRoot $temp /E /XD '.git' 'backups' 'node_modules' 'dist' '.zcode' `
    /XF '*.log' '.visible-*' /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Write-Host "FAILED: robocopy exit $LASTEXITCODE"; exit 1 }

# Архивируем
Compress-Archive -Path (Join-Path $temp '*') -DestinationPath $zip -Force
if (-not (Test-Path $zip)) { Write-Host 'FAILED: zip not created'; exit 1 }

# Проверка читаемости архива (получаем список записей через .NET)
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
    $check = [System.IO.Compression.ZipFile]::OpenRead($zip)
    $entries = $check.Entries.Count
    $check.Dispose()
    if ($entries -lt 1) { Write-Host 'FAILED: archive is empty'; exit 1 }
} catch {
    Write-Host "FAILED: archive not readable: $_"; exit 1
}

Remove-Item -Recurse -Force $temp

# Храним последние 8 архивов
$old = Get-ChildItem 'backups' -Filter 'NovaGrid-backup-*.zip' |
    Sort-Object Name -Descending | Select-Object -Skip 8
foreach ($f in $old) { Remove-Item $f.FullName -Force }

$size = [math]::Round((Get-Item $zip).Length / 1KB)
Write-Host "OK: $zip ($size KB)"
