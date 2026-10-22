param(
  [int]$AppProcessId = 0,
  [ValidateRange(1, 600)][int]$Seconds = 60,
  [ValidateRange(20, 1000)][int]$IntervalMs = 50,
  [string]$OutputPath
)

# Read-only native tracing. Does not capture pixels, read documents, change
# preferences, invoke app commands, or modify either Veil or Discord windows.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class VeilCaptureDiagnostic {
  public delegate bool EnumProc(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
  [DllImport("user32.dll", SetLastError=true)] static extern bool GetWindowDisplayAffinity(IntPtr window, out uint affinity);
  [DllImport("user32.dll", SetLastError=true)] static extern bool GetLayeredWindowAttributes(IntPtr window, out uint color, out byte alpha, out uint flags);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("dwmapi.dll")] public static extern int DwmIsCompositionEnabled(out bool enabled);
  public class State {
    public long hwnd;
    public uint processId;
    public uint threadId;
    public string windowClass;
    public bool visible;
    public string extendedStyle;
    public bool layeredStyle;
    public bool noRedirectionBitmap;
    public bool clickThrough;
    public bool topmost;
    public bool affinityRead;
    public uint affinity;
    public int affinityError;
    public bool alphaRead;
    public byte alpha;
    public uint alphaFlags;
    public int alphaError;
  }
  public static State[] Read(uint pid) {
    var states = new List<State>();
    EnumWindows((window, parameter) => {
      uint process; uint thread = GetWindowThreadProcessId(window, out process);
      if (process != pid) return true;
      var title = new StringBuilder(128);
      GetWindowText(window, title, title.Capacity);
      if (title.ToString() != "Veil overlay") return true;
      var klass = new StringBuilder(128);
      GetClassName(window, klass, klass.Capacity);
      long style = GetWindowLongPtr(window, -20).ToInt64();
      uint affinity; bool affinityRead = GetWindowDisplayAffinity(window, out affinity);
      int error = affinityRead ? 0 : Marshal.GetLastWin32Error();
      uint color, flags; byte alpha;
      bool alphaRead = GetLayeredWindowAttributes(window, out color, out alpha, out flags);
      int alphaError = alphaRead ? 0 : Marshal.GetLastWin32Error();
      states.Add(new State {
        hwnd=window.ToInt64(), processId=process, threadId=thread, windowClass=klass.ToString(),
        visible=IsWindowVisible(window), extendedStyle="0x"+style.ToString("X"),
        layeredStyle=(style & 0x80000)!=0, noRedirectionBitmap=(style & 0x200000)!=0,
        clickThrough=(style & 0x20)!=0, topmost=(style & 8)!=0,
        affinityRead=affinityRead, affinity=affinity, affinityError=error,
        alphaRead=alphaRead, alpha=alpha, alphaFlags=flags, alphaError=alphaError
      });
      return true;
    }, IntPtr.Zero);
    return states.ToArray();
  }
}
'@

if (!$OutputPath) {
  $taskRoot = Split-Path $PSScriptRoot -Parent
  $traceDirectory = if ((Split-Path $PSScriptRoot -Leaf) -eq 'scripts' -and
    (Test-Path -LiteralPath (Join-Path $taskRoot 'PROJECT_SPEC.md'))) {
    Join-Path $taskRoot 'target/capture-diagnostics'
  } else {
    # A standalone copy can be run beside the installed app, without source/builds.
    Join-Path $PSScriptRoot 'capture-diagnostics'
  }
  New-Item -ItemType Directory -Force -Path $traceDirectory | Out-Null
  $OutputPath = Join-Path $traceDirectory ((Get-Date -Format 'yyyyMMdd-HHmmss') + '.jsonl')
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $OutputPath) { throw 'Refusing to overwrite an existing trace.' }
$writer = [System.IO.StreamWriter]::new($OutputPath, $false, [System.Text.UTF8Encoding]::new($false))
try {
  # Collect versions only. Do not include process paths, command lines, user names,
  # browser profiles, Discord logs, screenshots or document contents.
  $metadataWarnings = @()
  $os = $null
  $windowsVersion = [Environment]::OSVersion.Version.ToString()
  $windowsBuild = [string][Environment]::OSVersion.Version.Build
  $windowsVersionSource = 'Environment.OSVersion'
  try {
    $os = Get-CimInstance Win32_OperatingSystem
    $windowsVersion = $os.Version
    $windowsBuild = $os.BuildNumber
    $windowsVersionSource = 'Win32_OperatingSystem'
  } catch {
    $metadataWarnings += 'Windows CIM metadata unavailable; fallback OS version may depend on the PowerShell host manifest.'
  }
  $graphics = @()
  try {
    $graphics = @(Get-CimInstance Win32_VideoController | ForEach-Object {
      @{ name=$_.Name; driverVersion=$_.DriverVersion; driverDate=[string]$_.DriverDate }
    })
  } catch { $metadataWarnings += 'Graphics driver metadata unavailable.' }
  $runningWebView2Versions = @(Get-Process -Name 'msedgewebview2' -ErrorAction SilentlyContinue |
    ForEach-Object { try { $_.ProductVersion } catch { } } | Where-Object { $_ } | Sort-Object -Unique)
  $discordVersions = @(Get-Process -Name 'Discord', 'DiscordPTB', 'DiscordCanary' -ErrorAction SilentlyContinue |
    ForEach-Object {
      $version = $null
      try { $version = $_.ProductVersion } catch { }
      @{ name=$_.ProcessName; productVersion=$version }
    } |
    Sort-Object -Property name, productVersion -Unique)
  [bool]$composition = $false
  $compositionResult = [VeilCaptureDiagnostic]::DwmIsCompositionEnabled([ref]$composition)
  $writer.WriteLine((@{
    type='environment'; schemaVersion=2; utc=[DateTime]::UtcNow.ToString('o');
    windows=$windowsVersion; windowsName=$os.Caption; windowsBuild=$windowsBuild;
    windowsVersionSource=$windowsVersionSource;
    graphics=$graphics; runningWebView2Versions=$runningWebView2Versions;
    discordVersions=$discordVersions; metadataWarnings=$metadataWarnings;
    composition=$composition; compositionResult=$compositionResult;
    requestedProcessId=$AppProcessId; intervalMs=$IntervalMs
  } | ConvertTo-Json -Depth 5 -Compress))
  Write-Output "Tracing for $Seconds seconds: $OutputPath"
  Write-Output 'Keep the Discord share running. Show the overlay, try Reapply and hide/wait/show, then toggle exclusion off/on. Note the remote result and time for each action.'
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $lastState = ''
  $seenProcesses = @{}
  while ($watch.Elapsed.TotalSeconds -lt $Seconds) {
    $processes = if ($AppProcessId) {
      @(Get-Process -Id $AppProcessId -ErrorAction SilentlyContinue)
    } else {
      @(Get-Process -Name 'veil-desktop', 'Veil' -ErrorAction SilentlyContinue)
    }
    $states = @()
    foreach ($process in $processes) {
      if (!$seenProcesses.ContainsKey($process.Id)) {
        $seenProcesses[$process.Id] = $true
        $executableHash = $null
        $fileVersion = $null
        $productVersion = $null
        try {
          $fileVersion = $process.FileVersion
          $productVersion = $process.ProductVersion
          if ($process.Path) {
            $executableHash = (Get-FileHash -LiteralPath $process.Path -Algorithm SHA256).Hash
          }
        } catch { } # A protected or exiting process must not stop window tracing.
        $writer.WriteLine((@{
          type='process'; utc=[DateTime]::UtcNow.ToString('o');
          elapsedMs=$watch.ElapsedMilliseconds; processId=$process.Id;
          executableName=$process.ProcessName; fileVersion=$fileVersion;
          productVersion=$productVersion; executableSha256=$executableHash
        } | ConvertTo-Json -Compress))
      }
      $states += [VeilCaptureDiagnostic]::Read($process.Id)
    }
    $state = ConvertTo-Json -InputObject @($states) -Compress
    if ($state -ne $lastState) {
      $writer.WriteLine((@{
        type='state'; utc=[DateTime]::UtcNow.ToString('o'); elapsedMs=$watch.ElapsedMilliseconds;
        windows=@($states)
      } | ConvertTo-Json -Depth 4 -Compress))
      $writer.Flush()
      $lastState = $state
    }
    Start-Sleep -Milliseconds $IntervalMs
  }
  $writer.WriteLine((@{ type='end'; elapsedMs=$watch.ElapsedMilliseconds } | ConvertTo-Json -Compress))
} finally {
  $writer.Dispose()
}
