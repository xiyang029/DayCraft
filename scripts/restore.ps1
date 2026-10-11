#Requires -Version 7.0
<#
.SYNOPSIS
    DayCraft SQLite 恢复脚本
.DESCRIPTION
    流程：校验备份完整性 -> 确认服务已停 -> 自动备份当前库 -> 替换 -> 再次校验。
.EXAMPLE
    .\scripts\restore.ps1 -Backup db_backups\20260101-120000
    .\scripts\restore.ps1 -Backup db_backups\20260101-120000\daycraft.db
#>
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Backup
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Write-Log([string]$Message) { Write-Host "[restore] $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "[Warn] $Message" -ForegroundColor Yellow }
function Die([string]$Message) { Write-Host "[Error] $Message" -ForegroundColor Red -ErrorAction Continue; exit 1 }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die '未检测到 node，无法恢复' }

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

# ---------- 1. 解析并校验备份源 ----------
if (-not (Test-Path -LiteralPath $Backup)) { Die "路径不存在: $Backup" }
$Src = if (Test-Path -LiteralPath $Backup -PathType Container) {
    (Get-ChildItem -LiteralPath $Backup -Filter '*.db' -File | Select-Object -First 1).FullName
} else {
    (Get-Item -LiteralPath $Backup).FullName
}
if (-not $Src) { Die "目录里没有 .db 文件: $Backup" }

Write-Log "校验备份文件: $Src"
$env:DAYCRAFT_SRC = $Src
$verifyJs = @'
const { DatabaseSync } = require("node:sqlite");
let db;
try {
  db = new DatabaseSync(process.env.DAYCRAFT_SRC, { readOnly: true });
  const r = db.prepare("PRAGMA integrity_check").get();
  const verdict = r.integrity_check ?? Object.values(r)[0];
  if (verdict !== "ok") throw new Error("integrity_check: " + verdict);
  const n = db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table' AND name='users'").get().c;
  if (n !== 1) throw new Error("缺少 users 表，这可能不是 DayCraft 数据库");
} catch (e) {
  console.error(String(e.message || e));
  process.exit(1);
} finally {
  if (db) db.close();
}
'@
node -e $verifyJs
if ($LASTEXITCODE -ne 0) { Die '备份文件校验失败，已中止（未改动任何数据）' }

# ---------- 2. 必须停服 ----------
function Test-PortBusy([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        return $client.ConnectAsync('127.0.0.1', $Port).Wait(800) -and $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

$busy = @()
foreach ($p in @([int](Get-EnvValue 'PORT' '3000'), [int](Get-EnvValue 'SERVER_DEV_PORT' '3001'))) {
    if (Test-PortBusy $p) { $busy += $p }
}
if ($busy.Count -gt 0) {
    Die "检测到服务仍在监听端口: $($busy -join ',') —— 请先停服再恢复（Ctrl+C 停 pnpm dev，或 docker stop daycraft）"
}

# ---------- 3. 自动备份当前库 ----------
if (Test-Path -LiteralPath $Db -PathType Leaf) {
    Write-Log '先备份当前库 ...'
    & (Join-Path $PSScriptRoot 'backup.ps1') -Label 'pre-restore'
    if ($LASTEXITCODE -ne 0) { Die '预备份失败，已中止（未改动任何数据）' }
} else {
    Write-Warn '当前没有数据库文件，跳过预备份'
}

# ---------- 4. 替换 ----------
Write-Log "写入: $Db"
foreach ($f in @($Db, "$Db-wal", "$Db-shm")) {
    if (Test-Path -LiteralPath $f) {
        Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $f) { Die "无法删除 $f —— 服务可能仍在运行，请确认后重试" }
    }
}
Copy-Item -LiteralPath $Src -Destination $Db -Force

# ---------- 5. 校验结果 ----------
$env:DAYCRAFT_SRC = $Db
$postJs = @'
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.env.DAYCRAFT_SRC, { readOnly: true });
try {
  const r = db.prepare("PRAGMA integrity_check").get();
  const verdict = r.integrity_check ?? Object.values(r)[0];
  if (verdict !== "ok") throw new Error("integrity_check: " + verdict);
  const users = db.prepare("SELECT count(*) c FROM users").get().c;
  const projects = db.prepare("SELECT count(*) c FROM projects").get().c;
  console.log(`  完整性 ok / users=${users} / projects=${projects}`);
} finally {
  db.close();
}
'@
node -e $postJs
if ($LASTEXITCODE -ne 0) { Die '恢复后的数据库校验失败' }

Write-Log "恢复完成: $Src -> $Db"
Write-Log '启动服务: pnpm dev（开发）或 pnpm start（生产）'
