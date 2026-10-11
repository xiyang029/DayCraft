#Requires -Version 7.0
<#
.SYNOPSIS
  DayCraft 全接口冒烟测试：覆盖全部 48 个 API 端点，外加校验分支、鉴权分支、跨用户隔离。

.DESCRIPTION
  必须跑在 pwsh 7+（Windows PowerShell 5.1 会把 UTF-8 中文响应解析成乱码，
  且没有 -SkipHttpErrorCheck，4xx 会直接抛异常）。

  用法（先起隔离 server，勿连真实库）：

    # 终端1
    $env:NODE_ENV='production'; $env:PORT='3002'
    $env:SQLITE_DB_PATH='F:\DayCraft\smoke_test.db'
    node server\dist\index.js

    # 终端2
    .\scripts\smoke-all.ps1 -Base http://localhost:3002

  跑完杀掉 server 并删除 smoke_test.db*。

.NOTES
  脚本自身会注册两个随机邮箱的用户（第一个自动成为管理员），跑完通过
  管理员接口级联删除，不残留业务数据。周报/月报/项目周报无删除接口，
  会残留在隔离库里 —— 这正是必须用隔离库的原因。
#>
[CmdletBinding()]
param(
  [string]$Base = 'http://localhost:3002'
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $Base.TrimEnd('/')

# ---- 计数与断言基础设施 ----
$script:Pass = 0
$script:Fail = 0
$script:Failures = [System.Collections.Generic.List[string]]::new()

$adminSess = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$userSess = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$anonSess = [Microsoft.PowerShell.Commands.WebRequestSession]::new()

function Write-Section {
  param([string]$Title)
  Write-Host ''
  Write-Host "-- $Title" -ForegroundColor Cyan
}

function Invoke-Api {
  param(
    [Parameter(Mandatory)][string]$Method,
    [Parameter(Mandatory)][string]$Path,
    $Body,
    $Session
  )
  $params = @{
    Uri                = "$BaseUrl$Path"
    Method             = $Method
    SkipHttpErrorCheck = $true
    TimeoutSec         = 30
  }
  if ($Session) { $params.WebSession = $Session }
  if ($null -ne $Body) {
    $params.ContentType = 'application/json; charset=utf-8'
    $params.Body = [string](ConvertTo-Json -InputObject $Body -Depth 12 -Compress)
  }

  try {
    $resp = Invoke-WebRequest @params
  } catch {
    return [pscustomobject]@{ Status = -1; Json = $null; Raw = $_.Exception.Message }
  }

  $json = $null
  if ($resp.Content) {
    try { $json = $resp.Content | ConvertFrom-Json } catch { $json = $null }
  }
  return [pscustomobject]@{ Status = [int]$resp.StatusCode; Json = $json; Raw = [string]$resp.Content }
}

function Assert-Api {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Method,
    [Parameter(Mandatory)][string]$Path,
    $Body,
    $Session,
    [int[]]$Expect = @(200),
    [string]$Contains,
    [scriptblock]$Verify
  )

  $r = Invoke-Api -Method $Method -Path $Path -Body $Body -Session $Session
  $ok = $Expect -contains $r.Status
  $detail = "期望状态 $(($Expect -join '/'))，实得 $($r.Status)"

  if (-not $ok -and $r.Status -eq -1) {
    $detail = "请求异常: $($r.Raw)"
  }

  if ($ok -and $Contains) {
    $raw = if ($null -ne $r.Json) { ConvertTo-Json -InputObject $r.Json -Depth 12 -Compress } else { [string]$r.Raw }
    if (-not $raw.Contains($Contains)) {
      $ok = $false
      $detail = "响应未包含「$Contains」；实际: $raw"
    }
  }

  if ($ok -and $Verify) {
    try {
      $v = & $Verify $r.Json
      if ($v -is [string] -and $v.Length -gt 0) { $ok = $false; $detail = $v }
      elseif ($v -eq $false) { $ok = $false; $detail = '自定义断言返回 false' }
    } catch {
      $ok = $false
      $detail = "断言抛异常: $($_.Exception.Message)"
    }
  }

  if ($ok) {
    $script:Pass++
    Write-Host "  [OK]   $Name" -ForegroundColor Green
  } else {
    $script:Fail++
    $script:Failures.Add("$Name -> $detail")
    Write-Host "  [FAIL] $Name" -ForegroundColor Red
    Write-Host "         $detail" -ForegroundColor DarkRed
  }

  return $r.Json
}

# 取一组验证码并返回可塞进 body 的字段
function New-Captcha {
  param($Session)
  $r = Invoke-Api -Method GET -Path '/api/auth/captcha' -Session $Session
  if ($r.Status -ne 200 -or $null -eq $r.Json.token) {
    throw "无法获取验证码（status=$($r.Status)），server 是否在 $BaseUrl 运行？"
  }
  return @{ captchaToken = [string]$r.Json.token; captcha = [string]$r.Json.code }
}

# ---- 前置：server 可达性 ----
Write-Host "DayCraft 冒烟测试 -> $BaseUrl" -ForegroundColor Yellow
try {
  $null = Invoke-WebRequest -Uri "$BaseUrl/api/__smoke_probe__" -SkipHttpErrorCheck -TimeoutSec 5
} catch {
  Write-Host "[ABORT] 无法连接 $BaseUrl。请先启动隔离 server（见脚本头部注释）。" -ForegroundColor Red
  exit 2
}

$stamp = Get-Date -Format 'MMddHHmmss'
$adminEmail = "smoke_admin_$stamp@example.com"
$userEmail = "smoke_user_$stamp@example.com"
$password = 'SmokePass123'
$today = '2026-10-11'
$otherDay = '2026-10-12'

# ============================================================
Write-Section 'A. 匿名访问与兜底路由'

$cap = Assert-Api -Name 'GET /api/auth/captcha 签发验证码' -Method GET -Path '/api/auth/captcha' -Session $anonSess `
  -Expect @(200) -Verify {
    param($j)
    if (-not $j.token) { return '缺少 token' }
    if (-not $j.code) { return '缺少 code' }
    if ([string]$j.code -notmatch '^[A-Za-z0-9]{4}$') { return "code 格式异常: $($j.code)" }
    if ($j.expiresIn -ne 300) { return "expiresIn 应为 300，实得 $($j.expiresIn)" }
    return $null
  }

Assert-Api -Name 'GET /api/auth/me 未登录 -> 401' -Method GET -Path '/api/auth/me' -Session $anonSess `
  -Expect @(401) -Contains '未登录' | Out-Null

Assert-Api -Name 'GET /api/projects 未登录 -> 401' -Method GET -Path '/api/projects' -Session $anonSess `
  -Expect @(401) -Contains '未授权访问' | Out-Null

Assert-Api -Name 'GET /api/admin/overview 未登录 -> 401' -Method GET -Path '/api/admin/overview' -Session $anonSess `
  -Expect @(401) | Out-Null

Assert-Api -Name 'GET /api/work-breakdown/items 未登录 -> 401' -Method GET -Path '/api/work-breakdown/items?project_id=x' -Session $anonSess `
  -Expect @(401) | Out-Null

Assert-Api -Name 'GET /api/不存在的接口 -> 404 兜底' -Method GET -Path '/api/no-such-endpoint' -Session $anonSess `
  -Expect @(404) -Contains '接口不存在' | Out-Null

Assert-Api -Name 'GET /api/share/非法token -> 404' -Method GET -Path '/api/share/not-a-token' -Session $anonSess `
  -Expect @(404) -Contains '分享链接无效' | Out-Null

# ============================================================
Write-Section 'B. 注册 / 登录 / 会话（第一个用户自动为管理员）'

Assert-Api -Name 'POST /api/auth/signup 缺邮箱密码 -> 400' -Method POST -Path '/api/auth/signup' -Session $anonSess `
  -Body @{} -Expect @(400) -Contains '请输入邮箱和密码' | Out-Null

Assert-Api -Name 'POST /api/auth/signup 邮箱格式错 -> 400' -Method POST -Path '/api/auth/signup' -Session $anonSess `
  -Body @{ email = 'bad-email'; password = $password } -Expect @(400) -Contains '邮箱格式不正确' | Out-Null

Assert-Api -Name 'POST /api/auth/signup 密码过短 -> 400' -Method POST -Path '/api/auth/signup' -Session $anonSess `
  -Body @{ email = $adminEmail; password = '123' } -Expect @(400) -Contains '密码长度至少为6个字符' | Out-Null

Assert-Api -Name 'POST /api/auth/signup 验证码错误 -> 400' -Method POST -Path '/api/auth/signup' -Session $anonSess `
  -Body @{ email = $adminEmail; password = $password; captchaToken = 'deadbeef'; captcha = 'ZZZZ' } `
  -Expect @(400) -Contains '验证码不正确或已过期，请刷新后重试' | Out-Null

$capAdmin = New-Captcha -Session $adminSess
$adminSignup = Assert-Api -Name 'POST /api/auth/signup 管理员注册 -> 200' -Method POST -Path '/api/auth/signup' `
  -Session $adminSess -Body @{
    name = '冒烟管理员'; email = $adminEmail; password = $password
    captchaToken = $capAdmin.captchaToken; captcha = $capAdmin.captcha
  } -Expect @(200) -Contains '注册成功'
$adminId = [string]$adminSignup.user.id

Assert-Api -Name 'GET /api/auth/me 首个用户角色含 admin' -Method GET -Path '/api/auth/me' -Session $adminSess `
  -Expect @(200) -Verify {
    param($j)
    if ($j.user.email -ne $adminEmail) { return "email 不符: $($j.user.email)" }
    if ($j.profile.role -notcontains 'admin') { return "role 应含 admin，实得 $($j.profile.role -join ',')" }
    return $null
  } | Out-Null

$capDup = New-Captcha -Session $anonSess
Assert-Api -Name 'POST /api/auth/signup 重复邮箱 -> 400' -Method POST -Path '/api/auth/signup' -Session $anonSess `
  -Body @{ email = $adminEmail; password = $password; captchaToken = $capDup.captchaToken; captcha = $capDup.captcha } `
  -Expect @(400) -Contains '该邮箱已被注册' | Out-Null

Assert-Api -Name 'POST /api/auth/logout -> 200' -Method POST -Path '/api/auth/logout' -Session $adminSess `
  -Expect @(200) -Contains '已退出登录' | Out-Null

Assert-Api -Name 'GET /api/auth/me 登出后 -> 401' -Method GET -Path '/api/auth/me' -Session $adminSess `
  -Expect @(401) | Out-Null

$capLogin = New-Captcha -Session $adminSess
Assert-Api -Name 'POST /api/auth/login 密码错误 -> 401' -Method POST -Path '/api/auth/login' -Session $adminSess `
  -Body @{ email = $adminEmail; password = 'WrongPass999'; captchaToken = $capLogin.captchaToken; captcha = $capLogin.captcha } `
  -Expect @(401) -Contains '邮箱或密码不正确' | Out-Null

$capLogin2 = New-Captcha -Session $adminSess
Assert-Api -Name 'POST /api/auth/login 正确凭据 -> 200' -Method POST -Path '/api/auth/login' -Session $adminSess `
  -Body @{ email = $adminEmail; password = $password; captchaToken = $capLogin2.captchaToken; captcha = $capLogin2.captcha } `
  -Expect @(200) | Out-Null

Assert-Api -Name 'GET /api/auth/me 登录后恢复会话' -Method GET -Path '/api/auth/me' -Session $adminSess `
  -Expect @(200) -Contains $adminEmail | Out-Null

# ============================================================
Write-Section 'C. 第二个用户与管理员权限'

$capUser = New-Captcha -Session $userSess
$userSignup = Assert-Api -Name 'POST /api/auth/signup 普通用户 -> 200' -Method POST -Path '/api/auth/signup' `
  -Session $userSess -Body @{
    name = '冒烟用户'; email = $userEmail; password = $password
    captchaToken = $capUser.captchaToken; captcha = $capUser.captcha
  } -Expect @(200)
$userId = [string]$userSignup.user.id

Assert-Api -Name 'GET /api/auth/me 普通用户角色不含 admin' -Method GET -Path '/api/auth/me' -Session $userSess `
  -Expect @(200) -Verify {
    param($j)
    if ($j.profile.role -contains 'admin') { return '普通用户不应含 admin 角色' }
    return $null
  } | Out-Null

Assert-Api -Name 'GET /api/admin/overview 非管理员 -> 403' -Method GET -Path '/api/admin/overview' -Session $userSess `
  -Expect @(403) -Contains '需要管理员权限' | Out-Null

Assert-Api -Name 'GET /api/admin/overview 管理员 -> 200' -Method GET -Path '/api/admin/overview' -Session $adminSess `
  -Expect @(200) -Verify {
    param($j)
    if ($j.users.Count -lt 2) { return "用户数应 >= 2，实得 $($j.users.Count)" }
    if ($null -eq $j.projectCounts) { return '缺少 projectCounts' }
    if ($null -eq $j.recentReports) { return '缺少 recentReports' }
    return $null
  } | Out-Null

Assert-Api -Name 'PUT /api/admin/users/:id 改自己 -> 400' -Method PUT -Path "/api/admin/users/$adminId" -Session $adminSess `
  -Body @{ role = @('user') } -Expect @(400) -Contains '不能修改自己的角色' | Out-Null

Assert-Api -Name 'DELETE /api/admin/users/:id 删自己 -> 400' -Method DELETE -Path "/api/admin/users/$adminId" -Session $adminSess `
  -Expect @(400) -Contains '不能删除自己' | Out-Null

Assert-Api -Name 'PUT /api/admin/users/:id 非法角色 -> 400' -Method PUT -Path "/api/admin/users/$userId" -Session $adminSess `
  -Body @{ role = @('superuser') } -Expect @(400) -Contains '角色不正确' | Out-Null

Assert-Api -Name 'PUT /api/admin/users/:id 空角色数组 -> 400' -Method PUT -Path "/api/admin/users/$userId" -Session $adminSess `
  -Body @{ role = @() } -Expect @(400) -Contains '角色不正确' | Out-Null

Assert-Api -Name 'PUT /api/admin/users/:id 提升为管理员 -> 200' -Method PUT -Path "/api/admin/users/$userId" -Session $adminSess `
  -Body @{ role = @('admin', 'user') } -Expect @(200) -Contains '角色更新成功' | Out-Null

Assert-Api -Name 'PUT /api/admin/users/:id 降回普通用户 -> 200' -Method PUT -Path "/api/admin/users/$userId" -Session $adminSess `
  -Body @{ role = @('user') } -Expect @(200) | Out-Null

Assert-Api -Name 'PUT /api/admin/users/:id 不存在用户 -> 404' -Method PUT -Path '/api/admin/users/no-such-user' -Session $adminSess `
  -Body @{ role = @('user') } -Expect @(404) -Contains '用户不存在' | Out-Null

# ============================================================
Write-Section 'D. AI 设置'

Assert-Api -Name 'GET /api/ai-settings -> 200' -Method GET -Path '/api/ai-settings' -Session $adminSess `
  -Expect @(200) -Verify {
    param($j)
    if ($null -eq $j.settings) { return '缺少 settings' }
    if ($null -eq $j.settings.api_url) { return '缺少 api_url' }
    return $null
  } | Out-Null

Assert-Api -Name 'PUT /api/ai-settings 非法 settings_type -> 400' -Method PUT -Path '/api/ai-settings' -Session $adminSess `
  -Body @{ settings_type = 'weird' } -Expect @(400) -Contains '设置类型不正确' | Out-Null

Assert-Api -Name 'PUT /api/ai-settings 保存 -> 200' -Method PUT -Path '/api/ai-settings' -Session $adminSess `
  -Body @{ model_name = 'smoke-model'; settings_type = 'custom'; is_enabled = $false } `
  -Expect @(200) -Contains 'AI 设置保存成功' | Out-Null

Assert-Api -Name 'GET /api/ai-settings 读回已保存值' -Method GET -Path '/api/ai-settings' -Session $adminSess `
  -Expect @(200) -Verify {
    param($j)
    if ($j.settings.model_name -ne 'smoke-model') { return "model_name 未持久化: $($j.settings.model_name)" }
    if ($j.settings.settings_type -ne 'custom') { return "settings_type 未持久化: $($j.settings.settings_type)" }
    if ($j.settings.is_enabled -ne $false) { return "is_enabled 应为 false，实得 $($j.settings.is_enabled)" }
    return $null
  } | Out-Null

# ============================================================
Write-Section 'E. 项目 CRUD'

Assert-Api -Name 'POST /api/projects 空名 -> 400' -Method POST -Path '/api/projects' -Session $adminSess `
  -Body @{ name = '  ' } -Expect @(400) -Contains '项目名称不能为空' | Out-Null

Assert-Api -Name 'POST /api/projects 名称超长 -> 400' -Method POST -Path '/api/projects' -Session $adminSess `
  -Body @{ name = ('x' * 101) } -Expect @(400) -Contains '项目名称不能超过100个字符' | Out-Null

$proj = Assert-Api -Name 'POST /api/projects 正常创建 -> 201' -Method POST -Path '/api/projects' -Session $adminSess `
  -Body @{ name = "冒烟项目$stamp"; code = "SMK$stamp"; description = '冒烟用项目' } `
  -Expect @(201) -Contains '项目创建成功'
$projectId = [string]$proj.project.id

Assert-Api -Name 'POST /api/projects 重名 -> 400' -Method POST -Path '/api/projects' -Session $adminSess `
  -Body @{ name = "冒烟项目$stamp" } -Expect @(400) -Contains '项目名称已存在' | Out-Null

Assert-Api -Name 'POST /api/projects 重编码 -> 400' -Method POST -Path '/api/projects' -Session $adminSess `
  -Body @{ name = "冒烟项目B$stamp"; code = "SMK$stamp" } -Expect @(400) -Contains '项目编码已存在' | Out-Null

Assert-Api -Name 'GET /api/projects 列表含新项目' -Method GET -Path '/api/projects' -Session $adminSess `
  -Expect @(200) -Verify {
    param($j)
    if ($j.projects.Count -lt 1) { return '项目列表为空' }
    if ($j.total -ne $j.projects.Count) { return 'total 与数组长度不一致' }
    if (($j.projects | Where-Object { $_.id -eq $projectId }).Count -ne 1) { return '未找到刚创建的项目' }
    return $null
  } | Out-Null

Assert-Api -Name 'GET /api/projects?active_only=true 过滤' -Method GET -Path '/api/projects?active_only=true' -Session $adminSess `
  -Expect @(200) | Out-Null

Assert-Api -Name 'GET /api/projects/:id 详情' -Method GET -Path "/api/projects/$projectId" -Session $adminSess `
  -Expect @(200) -Contains "SMK$stamp" | Out-Null

Assert-Api -Name 'GET /api/projects/:id 不存在 -> 404' -Method GET -Path '/api/projects/no-such-project' -Session $adminSess `
  -Expect @(404) -Contains '项目不存在' | Out-Null

Assert-Api -Name 'PUT /api/projects/:id 更新 -> 200' -Method PUT -Path "/api/projects/$projectId" -Session $adminSess `
  -Body @{ description = '冒烟用项目（已更新）'; is_active = $false } -Expect @(200) -Contains '项目更新成功' | Out-Null

Assert-Api -Name 'PUT /api/projects/:id 空名 -> 400' -Method PUT -Path "/api/projects/$projectId" -Session $adminSess `
  -Body @{ name = '' } -Expect @(400) -Contains '项目名称不能为空' | Out-Null

# ============================================================
Write-Section 'F. 日报'

Assert-Api -Name 'POST /api/daily-reports 日期格式错 -> 400' -Method POST -Path '/api/daily-reports' -Session $adminSess `
  -Body @{ date = '2026/10/11'; items = @(@{ project_id = $projectId; content = 'x' }) } `
  -Expect @(400) -Contains '日期格式不正确' | Out-Null

Assert-Api -Name 'POST /api/daily-reports 空 items -> 400' -Method POST -Path '/api/daily-reports' -Session $adminSess `
  -Body @{ date = $today; items = @() } -Expect @(400) -Contains '日报内容不能为空' | Out-Null

Assert-Api -Name 'POST /api/daily-reports 借用他人项目 -> 403' -Method POST -Path '/api/daily-reports' -Session $userSess `
  -Body @{ date = $today; items = @(@{ project_id = $projectId; content = '偷用' }) } `
  -Expect @(403) -Contains '包含不属于你的项目' | Out-Null

$daily = Assert-Api -Name 'POST /api/daily-reports 正常保存 -> 201' -Method POST -Path '/api/daily-reports' -Session $adminSess `
  -Body @{ date = $today; is_plan = $false; items = @(@{ project_id = $projectId; content = '完成冒烟接口' }) } `
  -Expect @(201) -Contains '日报保存成功'
$dailyId = [string]$daily.report.id

Assert-Api -Name 'GET /api/daily-reports?date= 单日查询' -Method GET -Path "/api/daily-reports?date=$today" -Session $adminSess `
  -Expect @(200) -Verify {
    param($j)
    if ($j.total -ne 1) { return "应命中 1 条，实得 $($j.total)" }
    return $null
  } | Out-Null

Assert-Api -Name 'GET /api/daily-reports?with_items=1 含明细与项目信息' -Method GET -Path "/api/daily-reports?date=$today&with_items=1" -Session $adminSess `
  -Expect @(200) -Verify {
    param($j)
    if ($j.reports[0].report_items.Count -ne 1) { return '明细条数应为 1' }
    if ($j.reports[0].report_items[0].projects.name -ne "冒烟项目$stamp") { return '明细未关联项目信息' }
    return $null
  } | Out-Null

Assert-Api -Name 'GET /api/daily-reports?start=&end= 区间查询' -Method GET -Path "/api/daily-reports?start=$today&end=$today" -Session $adminSess `
  -Expect @(200) | Out-Null

Assert-Api -Name 'PUT /api/daily-reports/:id 全量更新 -> 200' -Method PUT -Path "/api/daily-reports/$dailyId" -Session $adminSess `
  -Body @{ is_plan = $true; items = @(@{ project_id = $projectId; content = '更新后的内容' }) } `
  -Expect @(200) -Contains '日报更新成功' | Out-Null

Assert-Api -Name 'PUT /api/daily-reports/:id 不存在 -> 404' -Method PUT -Path '/api/daily-reports/no-such-report' -Session $adminSess `
  -Body @{ is_plan = $false } -Expect @(404) -Contains '日报不存在' | Out-Null

Assert-Api -Name 'POST /api/daily-reports 同日期 upsert -> 201' -Method POST -Path '/api/daily-reports' -Session $adminSess `
  -Body @{ date = $today; items = @(@{ project_id = $projectId; content = 'upsert 覆盖' }) } -Expect @(201) | Out-Null

Assert-Api -Name 'GET /api/daily-reports 同日期未重复插入' -Method GET -Path "/api/daily-reports?date=$today" -Session $adminSess `
  -Expect @(200) -Verify {
    param($j)
    if ($j.total -ne 1) { return "upsert 后应仍为 1 条，实得 $($j.total)" }
    return $null
  } | Out-Null

Assert-Api -Name 'DELETE /api/daily-reports/:id -> 200' -Method DELETE -Path "/api/daily-reports/$dailyId" -Session $adminSess `
  -Expect @(200) -Contains '日报删除成功' | Out-Null

Assert-Api -Name 'DELETE /api/daily-reports/:id 不存在 -> 404' -Method DELETE -Path "/api/daily-reports/$dailyId" -Session $adminSess `
  -Expect @(404) -Contains '日报不存在' | Out-Null

Assert-Api -Name 'GET /api/daily-reports 删除后为空' -Method GET -Path '/api/daily-reports' -Session $adminSess `
  -Expect @(200) -Verify {
    param($j)
    if ($j.total -ne 0) { return "删除后应为 0 条，实得 $($j.total)" }
    return $null
  } | Out-Null

# ============================================================
Write-Section 'G. 日报条目'

Assert-Api -Name 'POST /api/report-items 缺字段 -> 400' -Method POST -Path '/api/report-items' -Session $adminSess `
  -Body @{ project_id = $projectId } -Expect @(400) -Contains '项目与内容不能为空' | Out-Null

Assert-Api -Name 'POST /api/report-items 项目不存在 -> 404' -Method POST -Path '/api/report-items' -Session $adminSess `
  -Body @{ project_id = 'no-such-project'; content = 'x' } -Expect @(404) -Contains '项目不存在' | Out-Null

$item = Assert-Api -Name 'POST /api/report-items 传 date 自动建日报 -> 201' -Method POST -Path '/api/report-items' -Session $adminSess `
  -Body @{ date = $otherDay; project_id = $projectId; content = '待办联动条目' } -Expect @(201)
$itemId = [string]$item.item.id

Assert-Api -Name 'GET /api/daily-reports 自动建的日报已落库' -Method GET -Path "/api/daily-reports?date=$otherDay" -Session $adminSess `
  -Expect @(200) -Verify {
    param($j)
    if ($j.total -ne 1) { return "应自动建 1 条日报，实得 $($j.total)" }
    return $null
  } | Out-Null

Assert-Api -Name 'DELETE /api/report-items/:id -> 200' -Method DELETE -Path "/api/report-items/$itemId" -Session $adminSess `
  -Expect @(200) -Contains '删除成功' | Out-Null

Assert-Api -Name 'DELETE /api/report-items/:id 不存在 -> 404' -Method DELETE -Path "/api/report-items/$itemId" -Session $adminSess `
  -Expect @(404) -Contains '日报条目不存在' | Out-Null

# ============================================================
Write-Section 'H. 待办'

Assert-Api -Name 'POST /api/project-todos 缺项目 -> 400' -Method POST -Path '/api/project-todos' -Session $adminSess `
  -Body @{ content = 'x'; due_date = $today } -Expect @(400) -Contains '请选择项目' | Out-Null

Assert-Api -Name 'POST /api/project-todos 缺截止日期 -> 400' -Method POST -Path '/api/project-todos' -Session $adminSess `
  -Body @{ project_id = $projectId; content = 'x' } -Expect @(400) -Contains '截止日期格式不正确' | Out-Null

Assert-Api -Name 'POST /api/project-todos 非法优先级 -> 400' -Method POST -Path '/api/project-todos' -Session $adminSess `
  -Body @{ project_id = $projectId; content = 'x'; due_date = $today; priority = 'urgent' } `
  -Expect @(400) -Contains '优先级不正确' | Out-Null

Assert-Api -Name 'POST /api/project-todos 非法状态 -> 400' -Method POST -Path '/api/project-todos' -Session $adminSess `
  -Body @{ project_id = $projectId; content = 'x'; due_date = $today; status = 'done' } `
  -Expect @(400) -Contains '状态不正确' | Out-Null

$todo = Assert-Api -Name 'POST /api/project-todos 正常创建 -> 201' -Method POST -Path '/api/project-todos' -Session $adminSess `
  -Body @{ project_id = $projectId; content = '冒烟待办'; due_date = $today; priority = 'high' } `
  -Expect @(201) -Contains '待办创建成功'
$todoId = [string]$todo.todo.id

Assert-Api -Name 'GET /api/project-todos 列表含项目信息' -Method GET -Path '/api/project-todos' -Session $adminSess `
  -Expect @(200) -Verify {
    param($j)
    if ($j.total -lt 1) { return '待办列表为空' }
    $hit = $j.todos | Where-Object { $_.id -eq $todoId }
    if (-not $hit) { return '未找到刚创建的待办' }
    if ($hit.project.name -ne "冒烟项目$stamp") { return '待办未关联项目名称' }
    return $null
  } | Out-Null

Assert-Api -Name 'GET /api/project-todos?status=active 过滤' -Method GET -Path '/api/project-todos?status=active' -Session $adminSess `
  -Expect @(200) -Verify {
    param($j)
    if (($j.todos | Where-Object { $_.status -eq 'completed' }).Count -gt 0) { return 'active 过滤仍返回已完成项' }
    return $null
  } | Out-Null

Assert-Api -Name 'GET /api/project-todos?project_id= 过滤' -Method GET -Path "/api/project-todos?project_id=$projectId" -Session $adminSess `
  -Expect @(200) | Out-Null

Assert-Api -Name 'GET /api/project-todos/:id 详情' -Method GET -Path "/api/project-todos/$todoId" -Session $adminSess `
  -Expect @(200) -Contains '冒烟待办' | Out-Null

Assert-Api -Name 'PUT /api/project-todos/:id 标记完成 -> 200' -Method PUT -Path "/api/project-todos/$todoId" -Session $adminSess `
  -Body @{ status = 'completed' } -Expect @(200) -Verify {
    param($j)
    if ($j.todo.status -ne 'completed') { return "状态未更新: $($j.todo.status)" }
    if (-not $j.todo.completed_at) { return 'completed_at 未回填' }
    return $null
  } | Out-Null

Assert-Api -Name 'GET /api/project-todos?status=completed 已完成列表' -Method GET -Path '/api/project-todos?status=completed' -Session $adminSess `
  -Expect @(200) | Out-Null

Assert-Api -Name 'PUT /api/project-todos/:id 不存在 -> 404' -Method PUT -Path '/api/project-todos/no-such-todo' -Session $adminSess `
  -Body @{ status = 'completed' } -Expect @(404) -Contains '待办不存在' | Out-Null

Assert-Api -Name 'DELETE /api/project-todos/:id -> 200' -Method DELETE -Path "/api/project-todos/$todoId" -Session $adminSess `
  -Expect @(200) -Contains '待办删除成功' | Out-Null

Assert-Api -Name 'GET /api/project-todos/:id 删除后 -> 404' -Method GET -Path "/api/project-todos/$todoId" -Session $adminSess `
  -Expect @(404) | Out-Null

# ============================================================
Write-Section 'I. 周报 / 月报'

Assert-Api -Name 'GET /api/weekly-reports -> 200' -Method GET -Path '/api/weekly-reports' -Session $adminSess `
  -Expect @(200) -Verify { param($j) if ($null -eq $j.reports) { return '缺少 reports' } return $null } | Out-Null

Assert-Api -Name 'POST /api/weekly-reports 缺关键字段 -> 400' -Method POST -Path '/api/weekly-reports' -Session $adminSess `
  -Body @{ year = 2026 } -Expect @(400) -Contains '缺少周报关键字段' | Out-Null

Assert-Api -Name 'POST /api/weekly-reports 空内容 -> 400' -Method POST -Path '/api/weekly-reports' -Session $adminSess `
  -Body @{ year = 2026; week_number = 41; start_date = '2026-10-05'; end_date = '2026-10-11'; content = '  ' } `
  -Expect @(400) -Contains '周报内容不能为空' | Out-Null

Assert-Api -Name 'POST /api/weekly-reports 新建 -> 201' -Method POST -Path '/api/weekly-reports' -Session $adminSess `
  -Body @{ year = 2026; week_number = 41; start_date = '2026-10-05'; end_date = '2026-10-11'; content = '本周冒烟' } `
  -Expect @(201) -Contains '周报保存成功' | Out-Null

Assert-Api -Name 'POST /api/weekly-reports 同周 upsert -> 200' -Method POST -Path '/api/weekly-reports' -Session $adminSess `
  -Body @{ year = 2026; week_number = 41; start_date = '2026-10-05'; end_date = '2026-10-11'; content = '本周冒烟（改）' } `
  -Expect @(200) | Out-Null

Assert-Api -Name 'GET /api/weekly-reports 周报已落库' -Method GET -Path '/api/weekly-reports' -Session $adminSess `
  -Expect @(200) -Verify {
    param($j)
    $hit = $j.reports | Where-Object { $_.week_number -eq 41 -and $_.year -eq 2026 }
    if (-not $hit) { return '未找到 2026 年第 41 周周报' }
    if ($hit.content -ne '本周冒烟（改）') { return "upsert 未覆盖: $($hit.content)" }
    return $null
  } | Out-Null

Assert-Api -Name 'GET /api/monthly-reports -> 200' -Method GET -Path '/api/monthly-reports' -Session $adminSess `
  -Expect @(200) | Out-Null

Assert-Api -Name 'POST /api/monthly-reports 缺关键字段 -> 400' -Method POST -Path '/api/monthly-reports' -Session $adminSess `
  -Body @{ year = 2026 } -Expect @(400) -Contains '缺少月报关键字段' | Out-Null

Assert-Api -Name 'POST /api/monthly-reports 空内容 -> 400' -Method POST -Path '/api/monthly-reports' -Session $adminSess `
  -Body @{ year = 2026; month = 10; start_date = '2026-10-01'; end_date = '2026-10-31'; content = '' } `
  -Expect @(400) -Contains '月报内容不能为空' | Out-Null

Assert-Api -Name 'POST /api/monthly-reports 新建 -> 201' -Method POST -Path '/api/monthly-reports' -Session $adminSess `
  -Body @{ year = 2026; month = 10; start_date = '2026-10-01'; end_date = '2026-10-31'; content = '本月冒烟' } `
  -Expect @(201) -Contains '月报保存成功' | Out-Null

Assert-Api -Name 'POST /api/monthly-reports 同月 upsert -> 200' -Method POST -Path '/api/monthly-reports' -Session $adminSess `
  -Body @{ year = 2026; month = 10; start_date = '2026-10-01'; end_date = '2026-10-31'; content = '本月冒烟（改）' } `
  -Expect @(200) | Out-Null

Assert-Api -Name 'GET /api/monthly-reports 月报已落库' -Method GET -Path '/api/monthly-reports' -Session $adminSess `
  -Expect @(200) -Contains '本月冒烟（改）' | Out-Null

# ============================================================
Write-Section 'J. 项目周报'

Assert-Api -Name 'GET /api/project-weekly-reports -> 200' -Method GET -Path '/api/project-weekly-reports' -Session $adminSess `
  -Expect @(200) | Out-Null

Assert-Api -Name 'POST /api/project-weekly-reports 缺关键字段 -> 400' -Method POST -Path '/api/project-weekly-reports' -Session $adminSess `
  -Body @{ year = 2026 } -Expect @(400) -Contains '缺少项目周报关键字段' | Out-Null

Assert-Api -Name 'POST /api/project-weekly-reports 借用他人项目 -> 403' -Method POST -Path '/api/project-weekly-reports' -Session $userSess `
  -Body @{ year = 2026; week_number = 41; start_date = '2026-10-05'; end_date = '2026-10-11'; items = @(@{ project_id = $projectId; content = '偷用' }) } `
  -Expect @(403) -Contains '包含不属于你的项目' | Out-Null

$pw = Assert-Api -Name 'POST /api/project-weekly-reports 新建 -> 201' -Method POST -Path '/api/project-weekly-reports' -Session $adminSess `
  -Body @{
    year = 2026; week_number = 41; start_date = '2026-10-05'; end_date = '2026-10-11'; is_plan = $false
    items = @(@{ project_id = $projectId; content = '项目周报条目'; project_name = "冒烟项目$stamp"; project_code = "SMK$stamp" })
  } -Expect @(201) -Contains '项目周报保存成功'
$pwId = [string]$pw.report.id

Assert-Api -Name 'GET /api/project-weekly-reports?year=&week_number= 精确查询' -Method GET -Path '/api/project-weekly-reports?year=2026&week_number=41' -Session $adminSess `
  -Expect @(200) -Verify {
    param($j)
    if ($null -eq $j.report) { return '未找到项目周报' }
    if ($j.report.items.Count -ne 1) { return "明细条数应为 1，实得 $($j.report.items.Count)" }
    if ($j.report.items[0].projects.name -ne "冒烟项目$stamp") { return '明细未关联项目' }
    return $null
  } | Out-Null

Assert-Api -Name 'GET /api/project-weekly-reports?with_items=1 列表带明细' -Method GET -Path '/api/project-weekly-reports?with_items=1' -Session $adminSess `
  -Expect @(200) | Out-Null

Assert-Api -Name 'GET /api/project-weekly-reports 未命中周次返回 null' -Method GET -Path '/api/project-weekly-reports?year=1999&week_number=1' -Session $adminSess `
  -Expect @(200) -Verify { param($j) if ($null -ne $j.report) { return '未命中的周次应返回 report:null' } return $null } | Out-Null

Assert-Api -Name 'DELETE /api/project-weekly-reports/:id -> 200' -Method DELETE -Path "/api/project-weekly-reports/$pwId" -Session $adminSess `
  -Expect @(200) -Contains '项目周报删除成功' | Out-Null

Assert-Api -Name 'DELETE /api/project-weekly-reports/:id 不存在 -> 404' -Method DELETE -Path "/api/project-weekly-reports/$pwId" -Session $adminSess `
  -Expect @(404) -Contains '项目周报不存在' | Out-Null

# ============================================================
Write-Section 'K. 工作分解'

Assert-Api -Name 'GET /api/work-breakdown/items 缺 project_id -> 400' -Method GET -Path '/api/work-breakdown/items' -Session $adminSess `
  -Expect @(400) -Contains '缺少 project_id' | Out-Null

Assert-Api -Name 'GET /api/work-breakdown/items 项目不存在 -> 404' -Method GET -Path '/api/work-breakdown/items?project_id=no-such-project' -Session $adminSess `
  -Expect @(404) -Contains '项目不存在' | Out-Null

Assert-Api -Name 'POST /api/work-breakdown/items 空名 -> 400' -Method POST -Path '/api/work-breakdown/items' -Session $adminSess `
  -Body @{ project_id = $projectId; name = '  ' } -Expect @(400) -Contains '工作项名称不能为空' | Out-Null

Assert-Api -Name 'POST /api/work-breakdown/items 层级越界 -> 400' -Method POST -Path '/api/work-breakdown/items' -Session $adminSess `
  -Body @{ project_id = $projectId; name = 'x'; level = 9 } -Expect @(400) -Contains '层级不正确' | Out-Null

Assert-Api -Name 'POST /api/work-breakdown/items 非法状态 -> 400' -Method POST -Path '/api/work-breakdown/items' -Session $adminSess `
  -Body @{ project_id = $projectId; name = 'x'; status = 'doing' } -Expect @(400) -Contains '状态不正确' | Out-Null

$rootItem = Assert-Api -Name 'POST /api/work-breakdown/items 创建一级 -> 201' -Method POST -Path '/api/work-breakdown/items' -Session $adminSess `
  -Body @{ project_id = $projectId; name = '冒烟一级'; level = 0; position = 0; status = '进行中' } -Expect @(201)
$rootId = [string]$rootItem.id

Assert-Api -Name 'POST /api/work-breakdown/items 非法父级 -> 400' -Method POST -Path '/api/work-breakdown/items' -Session $adminSess `
  -Body @{ project_id = $projectId; name = 'x'; parent_id = 'no-such-item' } -Expect @(400) -Contains '父级工作项不存在' | Out-Null

$childItem = Assert-Api -Name 'POST /api/work-breakdown/items 创建子项 -> 201' -Method POST -Path '/api/work-breakdown/items' -Session $adminSess `
  -Body @{ project_id = $projectId; name = '冒烟子项'; level = 1; parent_id = $rootId; position = 0 } -Expect @(201)
$childId = [string]$childItem.id

Assert-Api -Name 'GET /api/work-breakdown/items 列表' -Method GET -Path "/api/work-breakdown/items?project_id=$projectId" -Session $adminSess `
  -Expect @(200) -Verify {
    param($j)
    if ($j.total -ne 2) { return "应有 2 个工作项，实得 $($j.total)" }
    if ($j.items[0].is_expanded -ne $true) { return 'is_expanded 布尔映射异常' }
    return $null
  } | Out-Null

Assert-Api -Name 'GET /api/work-breakdown/items/:id 详情' -Method GET -Path "/api/work-breakdown/items/$rootId" -Session $adminSess `
  -Expect @(200) -Contains '冒烟一级' | Out-Null

Assert-Api -Name 'GET /api/work-breakdown/items/:id 不存在 -> 404' -Method GET -Path '/api/work-breakdown/items/no-such-item' -Session $adminSess `
  -Expect @(404) -Contains '工作项不存在' | Out-Null

Assert-Api -Name 'PUT /api/work-breakdown/items/:id 更新字段 -> 200' -Method PUT -Path "/api/work-breakdown/items/$childId" -Session $adminSess `
  -Body @{ name = '冒烟子项（改）'; status = '已完成'; is_milestone = $true; progress_notes = '已收尾' } `
  -Expect @(200) -Verify {
    param($j)
    if ($j.item.name -ne '冒烟子项（改）') { return "name 未更新: $($j.item.name)" }
    if ($j.item.status -ne '已完成') { return "status 未更新: $($j.item.status)" }
    if ($j.item.is_milestone -ne $true) { return 'is_milestone 未更新' }
    return $null
  } | Out-Null

Assert-Api -Name 'PUT /api/work-breakdown/items/:id 非法状态 -> 400' -Method PUT -Path "/api/work-breakdown/items/$childId" -Session $adminSess `
  -Body @{ status = '乱写' } -Expect @(400) -Contains '状态不正确' | Out-Null

Assert-Api -Name 'PUT /api/work-breakdown/items 批量调整位置 -> 200' -Method PUT -Path '/api/work-breakdown/items' -Session $adminSess `
  -Body @{ updates = @(@{ id = $rootId; position = 5 }, @{ id = $childId; position = 6 }) } `
  -Expect @(200) -Contains '位置更新成功' | Out-Null

Assert-Api -Name 'PUT /api/work-breakdown/items 借用他人工作项 -> 403' -Method PUT -Path '/api/work-breakdown/items' -Session $userSess `
  -Body @{ updates = @(@{ id = $rootId; position = 1 }) } -Expect @(403) -Contains '包含不属于你的工作项' | Out-Null

Assert-Api -Name 'DELETE /api/work-breakdown/items/:id 删子项 -> 200' -Method DELETE -Path "/api/work-breakdown/items/$childId" -Session $adminSess `
  -Expect @(200) -Contains '工作项删除成功' | Out-Null

Assert-Api -Name 'DELETE /api/work-breakdown/items/:id 不存在 -> 404' -Method DELETE -Path "/api/work-breakdown/items/$childId" -Session $adminSess `
  -Expect @(404) -Contains '工作项不存在' | Out-Null

# ============================================================
Write-Section 'L. 工作分解分享（管理端）'

Assert-Api -Name 'POST /api/work-breakdown/share 空 project_ids -> 400' -Method POST -Path '/api/work-breakdown/share' -Session $adminSess `
  -Body @{ project_ids = @() } -Expect @(400) -Contains '请选择要分享的项目' | Out-Null

Assert-Api -Name 'POST /api/work-breakdown/share 借用他人项目 -> 403' -Method POST -Path '/api/work-breakdown/share' -Session $userSess `
  -Body @{ project_ids = @($projectId) } -Expect @(403) -Contains '包含不属于你的项目' | Out-Null

Assert-Api -Name 'POST /api/work-breakdown/share 非法过期时间 -> 400' -Method POST -Path '/api/work-breakdown/share' -Session $adminSess `
  -Body @{ project_ids = @($projectId); expires_at = 'not-a-date' } -Expect @(400) -Contains '过期时间格式不正确' | Out-Null

$shareRes = Assert-Api -Name 'POST /api/work-breakdown/share 创建带密码分享 -> 201' -Method POST -Path '/api/work-breakdown/share' -Session $adminSess `
  -Body @{ project_ids = @($projectId); password = 'sharepass123' } -Expect @(201) -Contains '分享创建成功'
$shareId = [string]$shareRes.share.id
$shareToken = [string]$shareRes.share.share_token

Assert-Api -Name 'POST /api/work-breakdown/share 响应不回传密码哈希' -Method GET -Path "/api/work-breakdown/share/$shareId" -Session $adminSess `
  -Expect @(200) -Verify {
    param($j)
    if ($null -ne $j.share.password_hash) { return '响应泄漏了 password_hash' }
    if ($j.share.has_password -ne $true) { return 'has_password 应为 true' }
    if ($j.share.projects.Count -ne 1) { return '未回传关联项目' }
    return $null
  } | Out-Null

Assert-Api -Name 'GET /api/work-breakdown/share 列表' -Method GET -Path '/api/work-breakdown/share' -Session $adminSess `
  -Expect @(200) -Verify {
    param($j)
    if (($j.shares | Where-Object { $_.id -eq $shareId }).Count -ne 1) { return '列表中未找到刚创建的分享' }
    return $null
  } | Out-Null

Assert-Api -Name 'GET /api/work-breakdown/share/:id?get_password=true' -Method GET -Path "/api/work-breakdown/share/$shareId`?get_password=true" -Session $adminSess `
  -Expect @(200) -Contains 'has_password' | Out-Null

Assert-Api -Name 'GET /api/work-breakdown/share/:id 不存在 -> 404' -Method GET -Path '/api/work-breakdown/share/no-such-share' -Session $adminSess `
  -Expect @(404) -Contains '分享不存在' | Out-Null

Assert-Api -Name 'PUT /api/work-breakdown/share/:id 非法过期时间 -> 400' -Method PUT -Path "/api/work-breakdown/share/$shareId" -Session $adminSess `
  -Body @{ expires_at = 'garbage' } -Expect @(400) -Contains '过期时间格式不正确' | Out-Null

Assert-Api -Name 'PUT /api/work-breakdown/share/:id 更新 -> 200' -Method PUT -Path "/api/work-breakdown/share/$shareId" -Session $adminSess `
  -Body @{ is_active = $true; expires_at = '2099-12-31T00:00:00.000Z' } -Expect @(200) -Contains '分享更新成功' | Out-Null

Assert-Api -Name 'DELETE /api/work-breakdown/share 清理过期分享 -> 200' -Method DELETE -Path '/api/work-breakdown/share' -Session $adminSess `
  -Expect @(200) -Contains '清理完成' | Out-Null

# ============================================================
Write-Section 'M. 公开分享访问（无鉴权）'

Assert-Api -Name 'GET /api/share/:token 无密码 -> 401 要求密码' -Method GET -Path "/api/share/$shareToken" -Session $anonSess `
  -Expect @(401) -Verify {
    param($j)
    if ($j.need_password -ne $true) { return '缺少 need_password 标记' }
    return $null
  } | Out-Null

Assert-Api -Name 'GET /api/share/:token 错误密码 -> 403' -Method GET -Path "/api/share/$shareToken`?password=wrongpass" -Session $anonSess `
  -Expect @(403) -Contains '访问密码不正确' | Out-Null

Assert-Api -Name 'GET /api/share/:token 正确密码 -> 200 返回工作项树' -Method GET -Path "/api/share/$shareToken`?password=sharepass123" -Session $anonSess `
  -Expect @(200) -Verify {
    param($j)
    if ($j.project.id -ne $projectId) { return 'project 不匹配' }
    if ($j.available_projects.Count -ne 1) { return 'available_projects 数量异常' }
    if ($null -eq $j.work_items) { return '缺少 work_items 树' }
    if ($j.work_items[0].children -isnot [array]) { return 'work_items 未构造成树' }
    if (-not $j.share_info.shared_by) { return '缺少 shared_by' }
    return $null
  } | Out-Null

Assert-Api -Name 'GET /api/share/:token?project_id= 指定项目' -Method GET -Path "/api/share/$shareToken`?password=sharepass123&project_id=$projectId" -Session $anonSess `
  -Expect @(200) | Out-Null

Assert-Api -Name 'POST /api/share/:token 错误密码 -> 403' -Method POST -Path "/api/share/$shareToken" -Session $anonSess `
  -Body @{ password = 'wrongpass' } -Expect @(403) -Contains '访问密码不正确' | Out-Null

Assert-Api -Name 'POST /api/share/:token 正确密码 -> 200' -Method POST -Path "/api/share/$shareToken" -Session $anonSess `
  -Body @{ password = 'sharepass123' } -Expect @(200) -Verify { param($j) if ($j.ok -ne $true) { return 'ok 不为 true' } return $null } | Out-Null

Assert-Api -Name 'DELETE /api/work-breakdown/share/:id 删除分享 -> 200' -Method DELETE -Path "/api/work-breakdown/share/$shareId" -Session $adminSess `
  -Expect @(200) -Contains '分享删除成功' | Out-Null

Assert-Api -Name 'GET /api/share/:token 删除后 -> 404' -Method GET -Path "/api/share/$shareToken`?password=sharepass123" -Session $anonSess `
  -Expect @(404) -Contains '分享链接无效或已过期' | Out-Null

# ============================================================
Write-Section 'N. 跨用户隔离与级联删除'

Assert-Api -Name 'GET /api/projects/:id 他人项目 -> 404' -Method GET -Path "/api/projects/$projectId" -Session $userSess `
  -Expect @(404) -Contains '项目不存在' | Out-Null

Assert-Api -Name 'PUT /api/projects/:id 他人项目 -> 404' -Method PUT -Path "/api/projects/$projectId" -Session $userSess `
  -Body @{ description = '越权修改' } -Expect @(404) | Out-Null

Assert-Api -Name 'DELETE /api/projects/:id 他人项目 -> 404' -Method DELETE -Path "/api/projects/$projectId" -Session $userSess `
  -Expect @(404) | Out-Null

Assert-Api -Name 'GET /api/daily-reports 他人看不到自己的日报' -Method GET -Path '/api/daily-reports' -Session $userSess `
  -Expect @(200) -Verify { param($j) if ($j.total -ne 0) { return "他人日报泄漏: $($j.total) 条" } return $null } | Out-Null

Assert-Api -Name 'GET /api/work-breakdown/share 他人看不到自己的分享' -Method GET -Path '/api/work-breakdown/share' -Session $userSess `
  -Expect @(200) -Verify { param($j) if ($j.total -ne 0) { return "他人分享泄漏: $($j.total) 条" } return $null } | Out-Null

Assert-Api -Name 'GET /api/ai-settings 各用户设置独立' -Method GET -Path '/api/ai-settings' -Session $userSess `
  -Expect @(200) -Verify {
    param($j)
    if ($j.settings.model_name -eq 'smoke-model') { return 'AI 设置跨用户串号' }
    return $null
  } | Out-Null

Assert-Api -Name 'DELETE /api/projects/:id 清理项目 -> 200' -Method DELETE -Path "/api/projects/$projectId" -Session $adminSess `
  -Expect @(200) -Contains '项目删除成功' | Out-Null

Assert-Api -Name 'DELETE /api/admin/users/:id 级联删除用户2 -> 200' -Method DELETE -Path "/api/admin/users/$userId" -Session $adminSess `
  -Expect @(200) -Contains '已删除' | Out-Null

Assert-Api -Name 'GET /api/auth/me 被删用户旧会话失效 -> 401' -Method GET -Path '/api/auth/me' -Session $userSess `
  -Expect @(401) -Contains '未登录' | Out-Null

Assert-Api -Name 'DELETE /api/admin/users/:id 再删 -> 404' -Method DELETE -Path "/api/admin/users/$userId" -Session $adminSess `
  -Expect @(404) -Contains '用户不存在' | Out-Null

$capNobody = New-Captcha -Session $anonSess
Assert-Api -Name 'POST /api/auth/reset-password 未注册邮箱 -> 404' -Method POST -Path '/api/auth/reset-password' -Session $anonSess `
  -Body @{ email = "nobody_$stamp@example.com"; newPassword = 'NewPass123'; captchaToken = $capNobody.captchaToken; captcha = $capNobody.captcha } `
  -Expect @(404) -Contains '该邮箱尚未注册' | Out-Null

Assert-Api -Name 'POST /api/auth/reset-password 新密码过短 -> 400' -Method POST -Path '/api/auth/reset-password' -Session $anonSess `
  -Body @{ email = $adminEmail; newPassword = '123'; captchaToken = 'x'; captcha = 'y' } `
  -Expect @(400) -Contains '密码长度至少为6个字符' | Out-Null

$capReset = New-Captcha -Session $anonSess
Assert-Api -Name 'POST /api/auth/reset-password 重置成功 -> 200' -Method POST -Path '/api/auth/reset-password' -Session $anonSess `
  -Body @{ email = $adminEmail; newPassword = 'ResetPass456'; captchaToken = $capReset.captchaToken; captcha = $capReset.captcha } `
  -Expect @(200) -Contains '密码重置成功，请使用新密码登录' | Out-Null

$capOld = New-Captcha -Session $anonSess
Assert-Api -Name 'POST /api/auth/login 旧密码已失效 -> 401' -Method POST -Path '/api/auth/login' -Session $anonSess `
  -Body @{ email = $adminEmail; password = $password; captchaToken = $capOld.captchaToken; captcha = $capOld.captcha } `
  -Expect @(401) | Out-Null

$capNew = New-Captcha -Session $anonSess
Assert-Api -Name 'POST /api/auth/login 新密码可登录 -> 200' -Method POST -Path '/api/auth/login' -Session $anonSess `
  -Body @{ email = $adminEmail; password = 'ResetPass456'; captchaToken = $capNew.captchaToken; captcha = $capNew.captcha } `
  -Expect @(200) | Out-Null

Assert-Api -Name 'POST /api/auth/logout 收尾 -> 200' -Method POST -Path '/api/auth/logout' -Session $anonSess `
  -Expect @(200) | Out-Null

# ============================================================
$total = $script:Pass + $script:Fail
Write-Host ''
Write-Host '========================================' -ForegroundColor Yellow
if ($script:Fail -eq 0) {
  Write-Host "全部通过：$script:Pass / $total" -ForegroundColor Green
} else {
  Write-Host "通过 $script:Pass / 失败 $script:Fail / 共 $total" -ForegroundColor Red
  Write-Host ''
  Write-Host '失败明细：' -ForegroundColor Red
  foreach ($f in $script:Failures) { Write-Host "  - $f" -ForegroundColor DarkRed }
}
Write-Host '========================================' -ForegroundColor Yellow

if ($script:Fail -gt 0) { exit 1 }
exit 0
