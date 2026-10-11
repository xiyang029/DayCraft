#Requires -Version 7.0
<#
.SYNOPSIS
    DayCraft SQLite 备份脚本
.DESCRIPTION
    用 node:sqlite 的 VACUUM INTO 做一致性快照 —— 只读事务，WAL 模式下
    服务运行中也能安全备份（不需要停服，也不需要 sqlite3 CLI）。
    直接 Copy-Item daycraft.db 是错的：WAL 里未 checkpoint 的数据会丢。
.EXAMPLE
    .\scripts\backup.ps1
    .\scripts\backup.ps1 -Label before-upgrade
#>
param(
    [string]$Label = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Write-Log([string]$Message) { Write-Host "[backup] $Message" -ForegroundColor Green }
function Die([string]$Message) { Write-Host "[Error] $Message" -ForegroundColor Red -ErrorAction Continue; exit 1 }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die '未检测到 node，无法备份' }

# 从 .env 读 SQLITE_DB_PATH（相对路径相对仓库根解析）
function Get-EnvValue([string]$Key, [string]$Default) {
    $line = Get-Content (Join-Path $Root '.env') -ErrorAction SilentlyContinue |
        Where-Object { $_ -match "^\s*$Key\s*=" } | Select-Object -Last 1
    if (-not $line) { return $Default }
    $value = ($line -split '=', 2)[1].Trim().Trim('"', "'")
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value
}

$dbRel = Get-EnvValue 'SQLITE_DB_PATH' './data/daycraft.db'
$Db = if ($dbRel -match '^([/\\]|[A-Za-z]:)') { $dbRel } else { Join-Path $Root ($dbRel -replace '^[.][/\\]', '') }
$Db = [System.IO.Path]::GetFullPath($Db)

if (-not (Test-Path -LiteralPath $Db -PathType Leaf)) { Die "数据库不存在: $Db" }

if ($Label) {
    $safe = ($Label -replace '[^A-Za-z0-9._-]', '-').Trim('-')
    $Label = if ($safe) { "-$safe" } else { '' }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Dest = Join-Path $Root "db_backups/$stamp$Label"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$Out = Join-Path $Dest (Split-Path -Leaf $Db)

$js = @'
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.env.DAYCRAFT_SRC, { readOnly: true });
try {
  db.exec("VACUUM INTO '" + process.env.DAYCRAFT_DST.replace(/'/g, "''") + "'");
} finally {
  db.close();
}
'@
$env:DAYCRAFT_SRC = $Db
$env:DAYCRAFT_DST = $Out
node -e $js
if ($LASTEXITCODE -ne 0) { Die '快照失败（VACUUM INTO 返回非零）' }

if (-not (Test-Path -LiteralPath $Out) -or (Get-Item -LiteralPath $Out).Length -eq 0) {
    Die '备份文件为空，备份失败'
}

$size = (Get-Item -LiteralPath $Out).Length
$hash = (Get-FileHash -LiteralPath $Out -Algorithm SHA256).Hash.ToLower()
@(
    "来源:   $Db"
    "时间:   $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    "大小:   $size 字节"
    "sha256: $hash"
) | Set-Content -Path (Join-Path $Dest 'meta.txt') -Encoding utf8

Write-Log "备份完成: $Dest"
Write-Log "  $(Split-Path -Leaf $Db)  $size 字节  sha256=$($hash.Substring(0, 12))..."
Write-Log "恢复: .\scripts\restore.ps1 -Backup `"$Dest`""
