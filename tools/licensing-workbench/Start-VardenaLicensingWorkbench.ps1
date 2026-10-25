#requires -Version 5.1
<#
Vardena Local Licensing Workbench
Windows GUI wrapper around the existing offline signer. Local-only; never uploads key material.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$backend = Join-Path $repoRoot 'owner-licensing\backend'
$signerCli = Join-Path $backend 'dist-signer\signer\cli.js'
$keygenCli = Join-Path $backend 'dist-signer\signer\keygen.js'
$keyInfoCli = Join-Path $backend 'dist-signer\signer\key-info.js'
$customerBackend = Join-Path $repoRoot 'backend'
$developerCli = Join-Path $customerBackend 'dist-tools\issue-development-license.js'
$nl = [Environment]::NewLine

function Show-Info([string]$Message) {
  [System.Windows.Forms.MessageBox]::Show($Message, 'Vardena Licensing Workbench', 'OK', 'Information') | Out-Null
}
function Show-Error([string]$Message) {
  [System.Windows.Forms.MessageBox]::Show($Message, 'Vardena Licensing Workbench', 'OK', 'Error') | Out-Null
}
function Invoke-Node([string]$ScriptPath, [string[]]$Arguments) {
  if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
    throw ("فایل ابزار پیدا نشد: " + $ScriptPath + $nl + "ابتدا دکمه «ساخت ابزار امضا» را بزن.")
  }
  if ($null -ne $env:OWNER_DATABASE_URL -or $null -ne $env:OWNER_PUBLIC_ORIGIN -or $env:NODE_ENV -eq 'production') {
    throw 'محیط Owner یا production شناسایی شد؛ ابزار امضای آفلاین را در یک نشست مستقل اجرا کن.'
  }
  $savedDb = $env:OWNER_DATABASE_URL
  $savedOrigin = $env:OWNER_PUBLIC_ORIGIN
  $savedNodeEnv = $env:NODE_ENV
  $savedErrorPreference = $ErrorActionPreference
  try {
    Remove-Item Env:OWNER_DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:OWNER_PUBLIC_ORIGIN -ErrorAction SilentlyContinue
    if ($env:NODE_ENV -eq 'production') { Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue }
    $ErrorActionPreference = 'Continue' # Windows PowerShell treats native stderr as ErrorRecord.
    $lines = & node $ScriptPath @Arguments 2>&1
    $ErrorActionPreference = $savedErrorPreference
    $exit = $LASTEXITCODE
    $outputBox.AppendText(($lines | Out-String) + $nl)
    if ($exit -ne 0) { throw ("ابزار با کد " + $exit + " متوقف شد. جزئیات در گزارش پایین آمده است.") }
    return ($lines | Out-String)
  } finally {
    $ErrorActionPreference = $savedErrorPreference
    if ($null -ne $savedDb) { $env:OWNER_DATABASE_URL = $savedDb } else { Remove-Item Env:OWNER_DATABASE_URL -ErrorAction SilentlyContinue }
    if ($null -ne $savedOrigin) { $env:OWNER_PUBLIC_ORIGIN = $savedOrigin } else { Remove-Item Env:OWNER_PUBLIC_ORIGIN -ErrorAction SilentlyContinue }
    if ($null -ne $savedNodeEnv) { $env:NODE_ENV = $savedNodeEnv } else { Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue }
  }
}
function Invoke-DeveloperNode([string[]]$Arguments) {
  if (-not (Test-Path -LiteralPath $developerCli -PathType Leaf)) {
    throw ("فایل ابزار مجوز توسعه‌دهنده پیدا نشد: " + $developerCli + $nl + "ابتدا دکمه «ساخت ابزار امضا» را بزن.")
  }
  $savedErrorPreference = $ErrorActionPreference
  try {
    # The official tool accepts private material only through a protected file.
    # Remove the obsolete variable from this Workbench process and do not
    # restore it: environment-based private-key custody is intentionally gone.
    Remove-Item Env:LICENSE_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    $ErrorActionPreference = 'Continue'
    $lines = & node $developerCli @Arguments 2>&1
    $ErrorActionPreference = $savedErrorPreference
    $exit = $LASTEXITCODE
    $outputBox.AppendText(($lines | Out-String) + $nl)
    if ($exit -ne 0) { throw ("ابزار مجوز توسعه‌دهنده با کد " + $exit + " متوقف شد.") }
    return ($lines | Out-String)
  } finally {
    $ErrorActionPreference = $savedErrorPreference
  }
}
function New-PrivateDirectory([string]$Base, [string]$Prefix) {
  $basePath = [System.IO.Path]::GetFullPath($Base)
  if (-not (Test-Path -LiteralPath $basePath -PathType Container)) { New-Item -ItemType Directory -Path $basePath -Force | Out-Null }
  $target = Join-Path $basePath ($Prefix + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Path $target | Out-Null
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $aclLines = & icacls.exe $target '/inheritance:r' '/grant:r' ('*' + $identity + ':(OI)(CI)(F)') 2>&1
  $outputBox.AppendText(($aclLines | Out-String) + $nl)
  if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
    throw 'تنظیم دسترسی پوشه ناموفق بود؛ هیچ کلیدی تولید نشد.'
  }
  return $target
}
function Pick-File([string]$Title, [string]$Filter = 'JSON files (*.json)|*.json|All files (*.*)|*.*') {
  $d = New-Object System.Windows.Forms.OpenFileDialog
  $d.Title = $Title; $d.Filter = $Filter; $d.CheckFileExists = $true
  if ($d.ShowDialog() -eq 'OK') { return $d.FileName }
  return $null
}
function Pick-SaveFile([string]$Title, [string]$FileName) {
  $d = New-Object System.Windows.Forms.SaveFileDialog
  $d.Title = $Title; $d.FileName = $FileName
  $d.Filter = 'JSON files (*.json)|*.json|All files (*.*)|*.*'; $d.OverwritePrompt = $true
  if ($d.ShowDialog() -eq 'OK') { return $d.FileName }
  return $null
}
function Pick-Folder([string]$Title) {
  $d = New-Object System.Windows.Forms.FolderBrowserDialog
  $d.Description = $Title; $d.ShowNewFolderButton = $true
  if ($d.ShowDialog() -eq 'OK') { return $d.SelectedPath }
  return $null
}
function Get-TextInput([string]$Title, [string]$Prompt, [string]$DefaultValue = '') {
  $dialog = New-Object System.Windows.Forms.Form
  $dialog.Text = $Title; $dialog.StartPosition = 'CenterParent'
  $dialog.Size = New-Object System.Drawing.Size(620, 170)
  $dialog.RightToLeft = 'Yes'; $dialog.RightToLeftLayout = $true
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Prompt; $label.Dock = 'Top'; $label.Height = 35; $label.TextAlign = 'MiddleRight'
  $entry = New-Object System.Windows.Forms.TextBox
  $entry.Dock = 'Top'; $entry.Font = New-Object System.Drawing.Font('Consolas', 10); $entry.Text = $DefaultValue
  $buttons = New-Object System.Windows.Forms.FlowLayoutPanel
  $buttons.Dock = 'Bottom'; $buttons.Height = 42; $buttons.FlowDirection = 'RightToLeft'
  $ok = New-Object System.Windows.Forms.Button; $ok.Text = 'ثبت'; $ok.DialogResult = 'OK'
  $cancel = New-Object System.Windows.Forms.Button; $cancel.Text = 'لغو'; $cancel.DialogResult = 'Cancel'
  $buttons.Controls.Add($ok); $buttons.Controls.Add($cancel)
  $dialog.Controls.Add($entry); $dialog.Controls.Add($label); $dialog.Controls.Add($buttons)
  $dialog.AcceptButton = $ok; $dialog.CancelButton = $cancel
  if ($dialog.ShowDialog($form) -eq 'OK') { return $entry.Text.Trim() }
  return $null
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Vardena — ابزار محلی امضای لایسنس'
$form.StartPosition = 'CenterScreen'; $form.Size = New-Object System.Drawing.Size(940, 900)
$form.MinimumSize = New-Object System.Drawing.Size(860, 780)
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$form.RightToLeft = 'Yes'; $form.RightToLeftLayout = $true

$root = New-Object System.Windows.Forms.TableLayoutPanel
$root.Dock = 'Fill'; $root.ColumnCount = 1; $root.RowCount = 5
[void]$root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle('Absolute', 70)))
[void]$root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle('Absolute', 165)))
[void]$root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle('Absolute', 190)))
[void]$root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle('Absolute', 125)))
[void]$root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle('Percent', 100)))
$form.Controls.Add($root)

$intro = New-Object System.Windows.Forms.Label
$intro.Dock = 'Fill'; $intro.Padding = New-Object System.Windows.Forms.Padding(10); $intro.TextAlign = 'MiddleRight'
$intro.Text = 'ابزار محلی ویندوز برای امضای تجاری Owner و صدور رسمی مجوز توسعه‌دهنده. کلید خصوصی ارسال نمی‌شود.' + $nl + 'مجوز توسعه‌دهنده فقط روی نصب دارای سیاست اعتماد صریح فعال می‌شود؛ NODE_ENV هیچ مجوزی ایجاد نمی‌کند.'
$root.Controls.Add($intro, 0, 0)

$setup = New-Object System.Windows.Forms.GroupBox
$setup.Text = '۱) ابزار و کلید'; $setup.Dock = 'Fill'; $setup.Padding = New-Object System.Windows.Forms.Padding(8)
$root.Controls.Add($setup, 0, 1)
$sg = New-Object System.Windows.Forms.TableLayoutPanel
$sg.Dock = 'Fill'; $sg.ColumnCount = 3; $sg.RowCount = 3
[void]$sg.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle('Percent', 100)))
[void]$sg.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle('Absolute', 140)))
[void]$sg.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle('Absolute', 140)))
$setup.Controls.Add($sg)
$keyDir = New-Object System.Windows.Forms.TextBox; $keyDir.Dock = 'Fill'; $keyDir.Text = Join-Path $env:USERPROFILE 'vardena-signing'
$keyId = New-Object System.Windows.Forms.TextBox; $keyId.Dock = 'Fill'
$btnBrowse = New-Object System.Windows.Forms.Button; $btnBrowse.Text = 'انتخاب پوشه'; $btnBrowse.Dock = 'Fill'
$btnBuild = New-Object System.Windows.Forms.Button; $btnBuild.Text = 'ساخت ابزار امضا'; $btnBuild.Dock = 'Fill'
$btnGenerate = New-Object System.Windows.Forms.Button; $btnGenerate.Text = 'ساخت کلید جدید'; $btnGenerate.Dock = 'Fill'
$btnInspect = New-Object System.Windows.Forms.Button; $btnInspect.Text = 'شناسایی کلید موجود'; $btnInspect.Dock = 'Fill'
$sg.Controls.Add($keyDir,0,0); $sg.Controls.Add($btnBrowse,1,0)
$sg.Controls.Add((New-Object System.Windows.Forms.Label -Property @{Text='مسیر پوشه کلید'; Dock='Fill'; TextAlign='MiddleRight'}),2,0)
$sg.Controls.Add($keyId,0,1)
$sg.Controls.Add((New-Object System.Windows.Forms.Label -Property @{Text='شناسه کلید (Key ID)'; Dock='Fill'; TextAlign='MiddleRight'}),2,1)
$sg.Controls.Add($btnBuild,0,2); $sg.Controls.Add($btnGenerate,1,2); $sg.Controls.Add($btnInspect,2,2)

$sign = New-Object System.Windows.Forms.GroupBox
$sign.Text = '۲) امضای درخواست مجوز یا ابطال'; $sign.Dock = 'Fill'; $sign.Padding = New-Object System.Windows.Forms.Padding(8)
$root.Controls.Add($sign, 0, 2)
$tg = New-Object System.Windows.Forms.TableLayoutPanel
$tg.Dock = 'Fill'; $tg.ColumnCount = 3; $tg.RowCount = 4
[void]$tg.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle('Percent', 100)))
[void]$tg.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle('Absolute', 130)))
[void]$tg.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle('Absolute', 150)))
$sign.Controls.Add($tg)
$requestPath = New-Object System.Windows.Forms.TextBox; $requestPath.Dock = 'Fill'
$digestPath = New-Object System.Windows.Forms.TextBox; $digestPath.Dock = 'Fill'
$statePath = New-Object System.Windows.Forms.TextBox; $statePath.Dock = 'Fill'; $statePath.ReadOnly = $true
$keyDir.Add_TextChanged({
  $keyId.Text = ''
  $digestPath.Text = ''
  try {
    $statePath.Text = if ($keyDir.Text.Trim()) { Join-Path ([System.IO.Path]::GetFullPath($keyDir.Text)) 'signer-state.log' } else { '' }
  } catch { $statePath.Text = '' }
})
$statePath.Text = Join-Path $keyDir.Text 'signer-state.log'
$btnRequest = New-Object System.Windows.Forms.Button; $btnRequest.Text = 'انتخاب درخواست'; $btnRequest.Dock = 'Fill'
$btnDigest = New-Object System.Windows.Forms.Button; $btnDigest.Text = 'ثبت هش از Owner'; $btnDigest.Dock = 'Fill'
$btnLicense = New-Object System.Windows.Forms.Button; $btnLicense.Text = 'امضای مجوز'; $btnLicense.Dock = 'Fill'
$btnRevoke = New-Object System.Windows.Forms.Button; $btnRevoke.Text = 'امضای ابطال'; $btnRevoke.Dock = 'Fill'
$tg.Controls.Add($requestPath,0,0); $tg.Controls.Add($btnRequest,1,0)
$tg.Controls.Add((New-Object System.Windows.Forms.Label -Property @{Text='فایل درخواست'; Dock='Fill'; TextAlign='MiddleRight'}),2,0)
$tg.Controls.Add($digestPath,0,1); $tg.Controls.Add($btnDigest,1,1)
$tg.Controls.Add((New-Object System.Windows.Forms.Label -Property @{Text='فایل هش ۶۴ رقمی'; Dock='Fill'; TextAlign='MiddleRight'}),2,1)
$tg.Controls.Add($statePath,0,2)
$tg.Controls.Add((New-Object System.Windows.Forms.Label -Property @{Text='فایل جلوگیری از امضای تکراری'; Dock='Fill'; TextAlign='MiddleRight'}),2,2)
$tg.Controls.Add($btnLicense,0,3); $tg.Controls.Add($btnRevoke,1,3)

$developer = New-Object System.Windows.Forms.GroupBox
$developer.Text = '۳) مجوز رسمی توسعه‌دهنده (آفلاین و مستقل از مشتری تجاری)'; $developer.Dock = 'Fill'; $developer.Padding = New-Object System.Windows.Forms.Padding(8)
$root.Controls.Add($developer, 0, 3)
$dg = New-Object System.Windows.Forms.TableLayoutPanel
$dg.Dock = 'Fill'; $dg.ColumnCount = 3; $dg.RowCount = 2
[void]$dg.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle('Percent', 100)))
[void]$dg.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle('Absolute', 180)))
[void]$dg.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle('Absolute', 180)))
$developer.Controls.Add($dg)
$developerKeyDir = New-Object System.Windows.Forms.TextBox; $developerKeyDir.Dock = 'Fill'; $developerKeyDir.Text = Join-Path $env:USERPROFILE 'vardena-developer-signing'
$btnDeveloperBrowse = New-Object System.Windows.Forms.Button; $btnDeveloperBrowse.Text = 'انتخاب پوشه کلید توسعه‌دهنده'; $btnDeveloperBrowse.Dock = 'Fill'
$btnDeveloperGenerate = New-Object System.Windows.Forms.Button; $btnDeveloperGenerate.Text = 'ساخت کلید توسعه‌دهنده'; $btnDeveloperGenerate.Dock = 'Fill'
$btnDeveloperIssue = New-Object System.Windows.Forms.Button; $btnDeveloperIssue.Text = 'صدور مجوز توسعه‌دهنده'; $btnDeveloperIssue.Dock = 'Fill'
$dg.Controls.Add($developerKeyDir,0,0); $dg.Controls.Add($btnDeveloperBrowse,1,0)
$dg.Controls.Add((New-Object System.Windows.Forms.Label -Property @{Text='پوشه امن کلید مجوز توسعه‌دهنده'; Dock='Fill'; TextAlign='MiddleRight'}),2,0)
$dg.Controls.Add((New-Object System.Windows.Forms.Label -Property @{Text='کلید و فایل خروجی هرگز بازنویسی نمی‌شوند.'; Dock='Fill'; TextAlign='MiddleRight'}),0,1)
$dg.Controls.Add($btnDeveloperGenerate,1,1); $dg.Controls.Add($btnDeveloperIssue,2,1)

$logGroup = New-Object System.Windows.Forms.GroupBox
$logGroup.Text = 'گزارش اجرا (بدون محتوای کلید خصوصی)'; $logGroup.Dock = 'Fill'; $logGroup.Padding = New-Object System.Windows.Forms.Padding(8)
$root.Controls.Add($logGroup,0,4)
$outputBox = New-Object System.Windows.Forms.TextBox
$outputBox.Dock = 'Fill'; $outputBox.Multiline = $true; $outputBox.ReadOnly = $true; $outputBox.ScrollBars = 'Vertical'
$outputBox.Font = New-Object System.Drawing.Font('Consolas', 9)
$logGroup.Controls.Add($outputBox)

$btnBrowse.Add_Click({
  $p = Pick-Folder 'پوشه‌ای را برای نگهداری کلید انتخاب کن'
  if ($p) { $keyDir.Text = $p }
})
$btnBuild.Add_Click({
  try {
    if (-not (Test-Path -LiteralPath (Join-Path $backend 'package.json'))) { throw ('مخزن پیدا نشد: ' + $repoRoot) }
    Push-Location $backend
    try {
      $lines = & npm run build:signer 2>&1
      $code = $LASTEXITCODE; $outputBox.AppendText(($lines | Out-String) + $nl)
      if ($code -ne 0) { throw ('ساخت ابزار شکست خورد: ' + $code) }
    } finally { Pop-Location }
    Push-Location $customerBackend
    try {
      $lines = & npm run build:tools 2>&1
      $code = $LASTEXITCODE; $outputBox.AppendText(($lines | Out-String) + $nl)
      if ($code -ne 0) { throw ('ساخت ابزار مجوز توسعه‌دهنده شکست خورد: ' + $code) }
    } finally { Pop-Location }
    Show-Info 'ساخت ابزارهای امضا و مجوز توسعه‌دهنده موفق بود.'
  } catch { Show-Error $_.Exception.Message }
})
$btnInspect.Add_Click({
  try {
    $keyPath = Join-Path $keyDir.Text 'key.pkcs8'
    if (-not (Test-Path -LiteralPath $keyPath -PathType Leaf)) { throw 'در پوشه انتخاب‌شده فایل key.pkcs8 وجود ندارد.' }
    $resultText = Invoke-Node $keyInfoCli @('--key', $keyPath)
    $result = $resultText | ConvertFrom-Json
    $keyId.Text = $result.keyId
    $outputBox.AppendText('شناسه کلید از کلید خصوصی استخراج شد؛ محتوای کلید نمایش داده نشد.' + $nl)
    Show-Info ('شناسه کلید: ' + $result.keyId + $nl + 'برای استفاده در صدور، بررسی کن همین شناسه در Owner ثبت و کلید عمومی آن در runtime مشتری مورد اعتماد باشد.')
  } catch { Show-Error $_.Exception.Message }
})
$btnGenerate.Add_Click({
  try {
    $newDir = New-PrivateDirectory $keyDir.Text 'authority'
    $resultText = Invoke-Node $keygenCli @('--out-dir', $newDir)
    $result = $resultText | ConvertFrom-Json
    $keyDir.Text = $newDir; $keyId.Text = $result.keyId
    Show-Info ('کلید ساخته شد.' + $nl + 'Key ID: ' + $result.keyId + $nl + 'کلید خصوصی فقط روی همین رایانه ذخیره شده است. آن را در چت، GitHub یا فایل‌های عمومی قرار نده.')
  } catch { Show-Error $_.Exception.Message }
})
$btnRequest.Add_Click({
  $p = Pick-File 'فایل درخواست امضا را از Owner انتخاب کن'
  if ($p) { $requestPath.Text = $p }
})
$btnDigest.Add_Click({
  try {
    $digest = Get-TextInput 'هش درخواست' 'مقدار request_payload_sha256 را از Owner کپی و اینجا وارد کن (۶۴ رقم هگز کوچک):'
    if ($null -eq $digest) { return }
    if ($digest -cnotmatch '^[0-9a-f]{64}$') { throw 'هش باید دقیقاً ۶۴ نویسه هگز کوچک باشد. از request_payload_sha256 استفاده کن، نه request_binding_sha256.' }
    $folder = [System.IO.Path]::GetFullPath($keyDir.Text)
    if (-not (Test-Path -LiteralPath $folder -PathType Container)) { throw 'پوشه کلید وجود ندارد.' }
    $target = Join-Path $folder ('request-digest-' + [guid]::NewGuid().ToString('N') + '.txt')
    $stream = [System.IO.File]::Open($target, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
    try {
      $bytes = [System.Text.Encoding]::ASCII.GetBytes($digest + [Environment]::NewLine)
      $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
    $digestPath.Text = $target
    $outputBox.AppendText('فایل هش درخواست در پوشه محلی ساخته شد.' + $nl)
  } catch { Show-Error $_.Exception.Message }
})
function Invoke-Sign([string]$Command) {
  try {
    if (-not $keyId.Text.Trim()) { throw 'شناسه کلید را وارد کن یا یک کلید بساز.' }
    if (-not (Test-Path -LiteralPath $requestPath.Text -PathType Leaf)) { throw 'فایل درخواست انتخاب نشده یا وجود ندارد.' }
    if (-not (Test-Path -LiteralPath $digestPath.Text -PathType Leaf)) { throw 'فایل هش انتخاب نشده یا وجود ندارد.' }
    if (-not (Test-Path -LiteralPath (Join-Path $keyDir.Text 'key.pkcs8') -PathType Leaf)) { throw 'فایل key.pkcs8 پیدا نشد.' }
    $expectedState = Join-Path ([System.IO.Path]::GetFullPath($keyDir.Text)) 'signer-state.log'
    if ($statePath.Text -ne $expectedState) { throw 'مسیر وضعیت امضا با پوشه کلید یکسان نیست.' }
    $defaultName = if ($Command -eq 'sign-license') { 'vardena-license-signed.json' } else { 'vardena-revocation-signed.json' }
    $out = Pick-SaveFile 'مسیر فایل امضاشده را انتخاب کن' $defaultName
    if (-not $out) { return }
    if (Test-Path -LiteralPath $out) { throw 'فایل خروجی از قبل وجود دارد؛ مسیر جدیدی انتخاب کن.' }
    $args = @($Command, '--request', $requestPath.Text, '--key', (Join-Path $keyDir.Text 'key.pkcs8'), '--key-id', $keyId.Text.Trim(), '--out', $out, '--state', $statePath.Text, '--digest-file', $digestPath.Text)
    $result = (Invoke-Node $signerCli $args) | ConvertFrom-Json
    if ($result.ok -ne $true -or -not (Test-Path -LiteralPath $out -PathType Leaf)) { throw 'ابزار امضا خروجی معتبر تولید نکرد.' }
    Show-Info ('امضا موفق بود.' + $nl + 'فایل: ' + $out + $nl + 'اکنون فایل را در Owner وارد کن و پس از موفقیت، جداگانه در برنامه مشتری وارد کن.')
  } catch { Show-Error $_.Exception.Message }
}
$btnLicense.Add_Click({ Invoke-Sign 'sign-license' })
$btnRevoke.Add_Click({ Invoke-Sign 'sign-revocation' })

$btnDeveloperBrowse.Add_Click({
  $p = Pick-Folder 'پوشه کلید رسمی مجوز توسعه‌دهنده را انتخاب کن'
  if ($p) { $developerKeyDir.Text = $p }
})
$btnDeveloperGenerate.Add_Click({
  try {
    $newDir = New-PrivateDirectory $developerKeyDir.Text 'developer-authority'
    $result = (Invoke-DeveloperNode @('--keygen', '--out-dir', $newDir)) | ConvertFrom-Json
    if ($result.ok -ne $true) { throw 'ساخت کلید توسعه‌دهنده تأیید نشد.' }
    $developerKeyDir.Text = $newDir
    Show-Info ('کلید رسمی توسعه‌دهنده ساخته شد.' + $nl + 'Key ID: ' + $result.keyId + $nl + 'فقط مقدار trustEntry داخل developer-license-key-info.json را روی نصب‌های مجاز تنظیم کن. کلید خصوصی را هرگز کپی نکن.')
  } catch { Show-Error $_.Exception.Message }
})
$btnDeveloperIssue.Add_Click({
  try {
    $privateKey = Join-Path $developerKeyDir.Text 'developer-license-key.pkcs8'
    if (-not (Test-Path -LiteralPath $privateKey -PathType Leaf)) { throw 'فایل developer-license-key.pkcs8 در پوشه انتخاب‌شده پیدا نشد.' }
    $installation = Get-TextInput 'شناسه نصب' 'installationId را دقیقاً از صفحه مجوز برنامه مقصد وارد کن:'
    if (-not $installation) { return }
    $developerId = Get-TextInput 'شناسه توسعه‌دهنده' 'یک شناسه پایدار غیرتجاری وارد کن (مثلاً developer-ali):'
    if (-not $developerId) { return }
    $developerName = Get-TextInput 'نام توسعه‌دهنده' 'نام نمایشی دارنده مجوز را وارد کن:'
    if (-not $developerName) { return }
    $untilDefault = (Get-Date).ToUniversalTime().AddDays(90).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $validUntil = Get-TextInput 'پایان اعتبار' 'زمان پایان را به UTC و دقیقاً با قالب ISO وارد کن:' $untilDefault
    if (-not $validUntil) { return }
    $organizations = Get-TextInput 'سقف سازمان' 'تعداد مثبت سازمان‌ها:' '2'
    if (-not $organizations) { return }
    $users = Get-TextInput 'سقف کاربر' 'تعداد مثبت کاربران:' '10'
    if (-not $users) { return }
    $modules = Get-TextInput 'ماژول‌ها' 'کد ماژول‌ها با ویرگول (نمونه: organization,users,rbac):' 'organization,users,rbac'
    if (-not $modules) { return }
    $features = Get-TextInput 'قابلیت‌ها' 'کد قابلیت‌ها با ویرگول؛ خالی مجاز است:' ''
    if ($null -eq $features) { return }
    $supersedes = Get-TextInput 'جایگزینی' 'برای مجوز جایگزین، operationId قبلی را وارد کن؛ برای اولین صدور خالی بگذار:' ''
    if ($null -eq $supersedes) { return }
    $issuedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $validFromDefault = if ($supersedes) { (Get-Date).ToUniversalTime().AddMinutes(15).ToString('yyyy-MM-ddTHH:mm:ss.fffZ') } else { $issuedAt }
    $validFrom = Get-TextInput 'شروع اعتبار' 'زمان شروع را به UTC وارد کن. برای جایگزینی، زمان آینده‌ای بگذار که فرصت انتقال و Import باشد:' $validFromDefault
    if (-not $validFrom) { return }
    $out = Pick-SaveFile 'فایل مجوز توسعه‌دهنده را ذخیره کن' 'vardena-developer-license.vdev.json'
    if (-not $out) { return }
    if (Test-Path -LiteralPath $out) { throw 'فایل خروجی از قبل وجود دارد؛ برای جلوگیری از بازنویسی مسیر تازه‌ای انتخاب کن.' }
    $args = @('--private-key-file', $privateKey, '--out', $out, '--installation', $installation, '--developer-id', $developerId, '--developer-name', $developerName, '--issued-at', $issuedAt, '--valid-from', $validFrom, '--valid-until', $validUntil, '--organizations', $organizations, '--users', $users, '--modules', $modules)
    if ($features) { $args += @('--features', $features) }
    if ($supersedes) { $args += @('--supersedes', $supersedes) }
    $result = (Invoke-DeveloperNode $args) | ConvertFrom-Json
    if ($result.ok -ne $true -or $result.verified -ne $true -or -not (Test-Path -LiteralPath $out -PathType Leaf)) { throw 'خروجی مجوز توسعه‌دهنده خودآزمایی نشد.' }
    Show-Info ('مجوز توسعه‌دهنده با موفقیت و به‌صورت آفلاین صادر و خودآزمایی شد.' + $nl + 'فایل: ' + $out + $nl + 'آن را از مسیر رسمی فعال‌سازی برنامه مقصد وارد کن؛ نیازی به Owner یا ساخت مشتری تجاری نیست.')
  } catch { Show-Error $_.Exception.Message }
})

$links = New-Object System.Windows.Forms.FlowLayoutPanel
$links.Dock = 'Bottom'; $links.Height = 38
$btnOwner = New-Object System.Windows.Forms.Button; $btnOwner.Text = 'بازکردن Owner'; $btnOwner.AutoSize = $true
$btnCustomer = New-Object System.Windows.Forms.Button; $btnCustomer.Text = 'بازکردن برنامه مشتری'; $btnCustomer.AutoSize = $true
$btnOwner.Add_Click({ Start-Process 'http://localhost:5174/app/licenses' })
$btnCustomer.Add_Click({ Start-Process 'http://localhost:5173' })
$logGroup.Controls.Add($links); $links.Controls.Add($btnOwner); $links.Controls.Add($btnCustomer)
[void]$form.ShowDialog()
