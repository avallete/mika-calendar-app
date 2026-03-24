$ErrorActionPreference = "Stop"

$chromeCandidates = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

$chrome = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
    throw "Chrome executable not found."
}

$port = 9222
$userDataDir = Join-Path $env:TEMP "codex-chrome-planner"

if (-not (Test-Path $userDataDir)) {
    New-Item -ItemType Directory -Path $userDataDir | Out-Null
}

try {
    $version = Invoke-WebRequest -Uri "http://127.0.0.1:$port/json/version" -UseBasicParsing |
        Select-Object -ExpandProperty Content
    $version
    exit 0
} catch {
}

$existing = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "chrome.exe" -and
    $_.CommandLine -like "*--remote-debugging-port=$port*" -and
    $_.CommandLine -like "*$userDataDir*"
}

if (-not $existing) {
    Start-Process -FilePath $chrome -ArgumentList @(
        "--headless=new",
        "--disable-gpu",
        "--remote-debugging-port=$port",
        "--user-data-dir=$userDataDir",
        "about:blank"
    ) | Out-Null

    Start-Sleep -Seconds 2
}

Invoke-WebRequest -Uri "http://127.0.0.1:$port/json/version" -UseBasicParsing |
    Select-Object -ExpandProperty Content
