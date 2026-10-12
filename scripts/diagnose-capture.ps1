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
  [DllImport("user32.dll")] static extern bool GetLayeredWindowAttributes(IntPtr window, out uint color, out byte alpha, out uint flags);
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
      states.Add(new State {
        hwnd=window.ToInt64(), processId=process, threadId=thread, windowClass=klass.ToString(),
        visible=IsWindowVisible(window), extendedStyle="0x"+style.ToString("X"),
        layeredStyle=(style & 0x80000)!=0, noRedirectionBitmap=(style & 0x200000)!=0,
        clickThrough=(style & 0x20)!=0, topmost=(style & 8)!=0,
        affinityRead=affinityRead, affinity=affinity, affinityError=error,
        alphaRead=alphaRead, alpha=alpha
      });
      return true;
    }, IntPtr.Zero);
    return states.ToArray();
  }
}
'@

if (!$OutputPath) {
  $taskRoot = Split-Path $PSScriptRoot -Parent
  $traceDirectory = Join-Path $taskRoot 'target/capture-diagnostics'
  New-Item -ItemType Directory -Force -Path $traceDirectory | Out-Null
  $OutputPath = Join-Path $traceDirectory ((Get-Date -Format 'yyyyMMdd-HHmmss') + '.jsonl')
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $OutputPath) { throw 'Refusing to overwrite an existing trace.' }
$writer = [System.IO.StreamWriter]::new($OutputPath, $false, [System.Text.UTF8Encoding]::new($false))
try {
  $os = Get-CimInstance Win32_OperatingSystem
  [bool]$composition = $false
  $compositionResult = [VeilCaptureDiagnostic]::DwmIsCompositionEnabled([ref]$composition)
  $writer.WriteLine((@{
    type='environment'; utc=[DateTime]::UtcNow.ToString('o'); windows=$os.Version;
    composition=$composition; compositionResult=$compositionResult;
    requestedProcessId=$AppProcessId; intervalMs=$IntervalMs
  } | ConvertTo-Json -Compress))
  Write-Output "Tracing for $Seconds seconds: $OutputPath"
  Write-Output 'Reproduce the black rectangle, try Reapply, then manually hide/wait/show. Note their times and Discord output.'
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
        $writer.WriteLine((@{
          type='process'; elapsedMs=$watch.ElapsedMilliseconds; processId=$process.Id;
          executable=$process.Path; fileVersion=$process.FileVersion
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
