param(
    [Parameter(Mandatory=$true)][ValidateSet('dev','prod')][string]$Environment,
    [Parameter(Mandatory=$true)][ValidateSet('backend','desktop')][string]$Service,
    [Parameter(Mandatory=$true)][ValidateSet('Start','Stop','Status')][string]$Action
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$env:PYTHONIOENCODING = 'utf-8'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$ports = @{dev=@{backend=19080;desktop=18982};prod=@{backend=19081;desktop=18882}}
$database = Join-Path $projectRoot "instance\$Environment\events.sqlite"
$repository = [IO.Path]::GetFullPath((Join-Path $projectRoot "..\..\DATA\compound-log\$Environment"))
$desktopData = $null
if ($env:COMPOUND_TOOLDOCK_CONFIG) {
    $configuration = Get-Content -LiteralPath $env:COMPOUND_TOOLDOCK_CONFIG -Raw -Encoding utf8 | ConvertFrom-Json
    foreach ($name in @('backend','desktop')) { $ports[$Environment][$name] = [int]$configuration.ports.$name }
    $database = [string]$configuration.database
    $repository = [string]$configuration.repository
    $desktopData = [string]$configuration.desktopData
}
$port = $ports[$Environment][$Service]
$webUrl = "http://127.0.0.1:$($ports[$Environment]['backend'])/"
$extensions = @{backend='py';desktop='cjs'}
$marker = Join-Path $PSScriptRoot "$Service.$($extensions[$Service])"

function Get-ServiceProcesses {
    $processes = @(Get-CimInstance Win32_Process)
    @($processes | Where-Object {
        $command = [string]$_.CommandLine
        $wrapped = $command.Replace('/','\').IndexOf($marker,[StringComparison]::OrdinalIgnoreCase) -ge 0
        $parent = $processes | Where-Object ProcessId -eq $_.ParentProcessId | Select-Object -First 1
        $python = Join-Path $projectRoot '.venv\Scripts\python.exe'
        $manual = $Service -eq 'backend' -and ($_.ExecutablePath -eq $python -or
            ($parent.ExecutablePath -eq $python -and $parent.CommandLine -match '(?:^|\s)-m\s+backend(?:\s|$)')) -and
            $command -match '(?:^|\s)-m\s+backend(?:\s|$)'
        $matchesEnvironment = $command -match ('--env"?\s+"?' + $Environment + '(?:"|\s|$)') -or
            ($manual -and $Environment -eq 'dev' -and $command -notmatch '--env')
        $defaultPort = if ($Environment -eq 'dev') {19080} else {19081}
        $matchesPort = $command -match ('--port"?\s+"?' + $port + '(?:"|\s|$)') -or
            ($manual -and $port -eq $defaultPort -and $command -notmatch '--port')
        $command -and ($wrapped -or $manual) -and $matchesEnvironment -and $matchesPort
    })
}
function Get-ServiceState {
    $owned = @(Get-ServiceProcesses)
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
        foreach ($listener in $listeners) {
            if ($owned.ProcessId -notcontains $listener.OwningProcess) { return @{state='failed';message="端口 $port 被其他进程占用，未接管"} }
        }
        try {
            if ($Service -eq 'backend') {
                $page = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 2
                if ($page.Content -notmatch '<title>Compound') {throw '后端身份不一致'}
            } else {
                $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/_tooldock/health" -TimeoutSec 2
                if ($health.app -ne "compound-$Service" -or $health.environment -ne $Environment) {throw '服务身份不一致'}
                if ($Service -eq 'desktop' -and -not $health.ready) {return @{state='starting';message='桌面页面正在加载'}}
            }
            $result = @{state='running';message="$Environment $Service 已运行"}
            if ($Service -eq 'backend') {$result.url=$webUrl}
            return $result
        } catch {return @{state='starting';message="$Environment $Service 进程存在，正在等待就绪"}}
    }
    if ($owned.Count -gt 0) {return @{state='starting';message="$Environment $Service 启动中"}}
    # 手工 Electron 使用同一环境的单实例锁，不能重复启动。
    if ($Service -eq 'desktop' -and -not $desktopData) {
        $manual = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object {
            $_.CommandLine -and $_.CommandLine.Replace('/','\').IndexOf((Join-Path $projectRoot 'desktop\main\index.cjs'),[StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            (($_.CommandLine -match '--prod') -eq ($Environment -eq 'prod'))
        })
        if ($manual.Count -gt 0) {return @{state='failed';message='同环境手动桌面已运行，请从托盘退出后改由工具坞启动'}}
    }
    return @{state='stopped';message="$Environment $Service 已停止"}
}

try {
    $state = Get-ServiceState
    if ($Action -eq 'Status') {$state | ConvertTo-Json -Compress; exit 0}
    if ($Action -eq 'Stop') {
        if ($state.state -eq 'failed') {throw $state.message}
        foreach ($process in @(Get-ServiceProcesses)) {
            # 每次停止前重新检查身份，避免陈旧 PID 指向陌生进程。
            $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ProcessId)" -ErrorAction SilentlyContinue
            if ($current -and $current.CreationDate -eq $process.CreationDate -and $current.CommandLine -eq $process.CommandLine) {Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue}
        }
        Write-Output "$Environment $Service 已停止"; exit 0
    }
    if ($state.state -in @('running','starting')) {Write-Output $state.message; exit 0}
    if ($state.state -eq 'failed') {throw $state.message}
    $runtime = Join-Path $projectRoot ".run\tooldock\$Environment"
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $arguments = @($marker,'--env',$Environment,'--port',[string]$port)
    if ($Service -eq 'backend') {
        $executable = Join-Path $projectRoot '.venv\Scripts\python.exe'
        if (-not (Test-Path -LiteralPath $executable)) {throw '请先安装项目 Python 环境'}
        $arguments += @('--db',$database,'--repo',$repository)
        $env:PYTHONIOENCODING='utf-8'
    } else {
        $executable = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
        if (-not (Test-Path -LiteralPath $executable)) {throw '请先 npm install 并启动一次 Electron 下载运行时'}
        $arguments += @('--backend-port',[string]$ports[$Environment]['backend'])
        if ($desktopData) {$env:COMPOUND_DESKTOP_DATA=$desktopData}
    }
    $requestFile = Join-Path $runtime "$Service.launch.json"
    @{executable=$executable;arguments=$arguments;directory=$projectRoot;visible=($Service -eq 'desktop');stdout=(Join-Path $runtime "$Service.stdout.log");stderr=(Join-Path $runtime "$Service.stderr.log")} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $requestFile -Encoding UTF8
    $launcher = Join-Path $projectRoot '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $launcher)) {throw '请先安装项目 Python 环境'}
    # Start-Process -Wait 会等待整个后代进程树；这里只等待短命启动器。
    & $launcher (Join-Path $PSScriptRoot 'launch.py') $requestFile
    if ($LASTEXITCODE -ne 0) {throw '服务启动进程失败，请检查运行日志'}
    Write-Output "$Environment $Service 启动请求已提交"
} catch {
    @{state='failed';message=$_.Exception.Message} | ConvertTo-Json -Compress
    exit 1
}
