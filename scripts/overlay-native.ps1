param(
  [Parameter(Mandatory=$true)][ValidateSet('Underlay','Raise','Focus','Probe','CursorProbe','MovePointer','Escape','Click','Drag','HoldDrag','Move','Recover','Toggle','CustomToggle','Capture','Pixel','Close')][string]$Action,
  [Parameter(Mandatory=$true)][int]$AppProcessId,
  [ValidateSet('main','overlay')][string]$Window = 'overlay',
  [int]$X = 0, [int]$Y = 0, [int]$ToX = 0, [int]$ToY = 0,
  [int]$Width = 0, [int]$Height = 0,
  [int]$KeyCode = 0x48,
  [string]$OutputPath
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class VeilNativeTest {
  public delegate bool EnumProc(IntPtr window, IntPtr parameter);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct CursorInfo { public uint Size, Flags; public IntPtr Cursor; public Point Position; }
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CursorInfo info);
  [DllImport("user32.dll", EntryPoint="LoadCursorW")] public static extern IntPtr LoadCursor(IntPtr instance, IntPtr name);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr window, ref Point point);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, System.Text.StringBuilder text, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
  [DllImport("user32.dll")] public static extern bool GetLayeredWindowAttributes(IntPtr window, out uint color, out byte alpha, out uint flags);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowDisplayAffinity(IntPtr window, out uint affinity);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint parameter, ref int value, uint flags);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  [DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr window);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr window, IntPtr dc);
  [DllImport("gdi32.dll")] public static extern uint GetPixel(IntPtr dc, int x, int y);
  public static IntPtr Find(int pid, bool overlay) {
    IntPtr result = IntPtr.Zero;
    EnumWindows((window, parameter) => {
      uint process; GetWindowThreadProcessId(window, out process);
      var text = new System.Text.StringBuilder(512); GetWindowText(window, text, text.Capacity);
      string title = text.ToString();
      if (process == pid && (overlay ? title == "Veil overlay" : title.StartsWith("Veil") && title != "Veil overlay")) { result = window; return false; }
      return true;
    }, IntPtr.Zero);
    return result;
  }
  public static void Click(int x, int y) { SetCursorPos(x, y); Thread.Sleep(70); mouse_event(2,0,0,0,UIntPtr.Zero); Thread.Sleep(70); mouse_event(4,0,0,0,UIntPtr.Zero); }
  public static void Escape() { keybd_event(0x1B,0,0,UIntPtr.Zero); Thread.Sleep(70); keybd_event(0x1B,0,2,UIntPtr.Zero); }
  public static void Drag(int x, int y, int toX, int toY) {
    SetCursorPos(x,y); Thread.Sleep(100); mouse_event(2,0,0,0,UIntPtr.Zero); Thread.Sleep(400);
    for (int step=1; step<=12; step++) { SetCursorPos(x+(toX-x)*step/12,y+(toY-y)*step/12); Thread.Sleep(35); }
    mouse_event(4,0,0,0,UIntPtr.Zero); Thread.Sleep(150);
  }
  public static void HoldDrag(int x, int y, int toX, int toY, string readyPath) {
    int original = 0;
    if (!SystemParametersInfo(0x26,0,ref original,0)) throw new Exception("Cannot read drag-full-windows setting.");
    int unused = 0;
    try {
      if (!SystemParametersInfo(0x25,0,ref unused,0)) throw new Exception("Cannot set outline-only dragging for regression.");
      SetCursorPos(x,y); Thread.Sleep(100); mouse_event(2,0,0,0,UIntPtr.Zero); Thread.Sleep(400);
      for (int step=1; step<=12; step++) { SetCursorPos(x+(toX-x)*step/12,y+(toY-y)*step/12); Thread.Sleep(35); }
      System.IO.File.WriteAllText(readyPath,"held");
      for (int step=0; step<300 && !System.IO.File.Exists(readyPath+".release"); step++) Thread.Sleep(50);
    } finally {
      mouse_event(4,0,0,0,UIntPtr.Zero);
      if (!SystemParametersInfo(0x25,(uint)original,ref unused,0)) throw new Exception("Cannot restore drag-full-windows setting.");
    }
  }
  public static void CustomShortcut(byte key) {
    keybd_event(0x11,0,0,UIntPtr.Zero); keybd_event(0x10,0,0,UIntPtr.Zero);
    keybd_event(key,0,0,UIntPtr.Zero); Thread.Sleep(100); keybd_event(key,0,2,UIntPtr.Zero);
    keybd_event(0x10,0,2,UIntPtr.Zero); keybd_event(0x11,0,2,UIntPtr.Zero); Thread.Sleep(150);
  }
  public static void Shortcut(bool shift) {
    keybd_event(0x11,0,0,UIntPtr.Zero); keybd_event(0x12,0,0,UIntPtr.Zero);
    if (shift) keybd_event(0x10,0,0,UIntPtr.Zero);
    keybd_event(0x56,0,0,UIntPtr.Zero); Thread.Sleep(100); keybd_event(0x56,0,2,UIntPtr.Zero);
    if (shift) keybd_event(0x10,0,2,UIntPtr.Zero);
    keybd_event(0x12,0,2,UIntPtr.Zero); keybd_event(0x11,0,2,UIntPtr.Zero); Thread.Sleep(150);
  }
}
'@
[VeilNativeTest]::SetProcessDPIAware() | Out-Null
if ($Action -eq 'Underlay') {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Veil M1 test surface'
  $form.StartPosition = 'Manual'
  $form.Location = New-Object System.Drawing.Point($X,$Y)
  $form.ClientSize = New-Object System.Drawing.Size(1000,650)
  $button = New-Object System.Windows.Forms.Button
  $button.Text = 'Underlying app: click here'
  $button.Dock = 'Fill'
  $button.FlatStyle = 'Flat'
  $button.BackColor = [System.Drawing.Color]::FromArgb(25,65,95)
  $button.UseVisualStyleBackColor = $false
  $button.ForeColor = [System.Drawing.Color]::White
  $button.Add_Click({ [System.IO.File]::WriteAllText($OutputPath,'clicked') })
  $form.Controls.Add($button)
  $form.Add_Shown({ [VeilNativeTest]::ShowWindow($form.Handle,9) | Out-Null; [VeilNativeTest]::SetForegroundWindow($form.Handle) | Out-Null })
  $form.ShowDialog() | Out-Null
  $form.Dispose()
  exit
}
$handle = [VeilNativeTest]::Find($AppProcessId, $Window -eq 'overlay')
if ($handle -eq [IntPtr]::Zero) { throw "Test window for process $AppProcessId is missing." }
$bounds = New-Object VeilNativeTest+Rect
[VeilNativeTest]::GetWindowRect($handle, [ref]$bounds) | Out-Null
switch ($Action) {
  'MovePointer' { [VeilNativeTest]::SetCursorPos($X,$Y) | Out-Null; Start-Sleep -Milliseconds 200 }
  'Escape' { [VeilNativeTest]::Escape() }
  'CursorProbe' {
    $cursor = New-Object VeilNativeTest+CursorInfo
    $cursor.Size = [System.Runtime.InteropServices.Marshal]::SizeOf($cursor)
    if (![VeilNativeTest]::GetCursorInfo([ref]$cursor)) { throw 'Cannot read Windows cursor.' }
    $name = 'other'
    foreach ($entry in @{ arrow=32512; text=32513; wait=32514; cross=32515; nwse=32642; nesw=32643; horizontal=32644; vertical=32645; move=32646; forbidden=32648; hand=32649; starting=32650 }.GetEnumerator()) {
      if ($cursor.Cursor -eq [VeilNativeTest]::LoadCursor([IntPtr]::Zero,[IntPtr]$entry.Value)) { $name = $entry.Key }
    }
    $owner = [VeilNativeTest]::GetAncestor([VeilNativeTest]::WindowFromPoint($cursor.Position),2)
    @{ name=$name; cursor=$cursor.Cursor.ToInt64(); overTestWindow=($owner -eq $handle); visible=($cursor.Flags -band 1) -ne 0; x=$cursor.Position.X; y=$cursor.Position.Y } | ConvertTo-Json -Compress
  }
  'Focus' {
    [VeilNativeTest]::ShowWindow($handle,9) | Out-Null
    # Raise within its current topmost/non-topmost band before pointer input.
    # Another app-owned overlay can otherwise intercept the test's mouse down.
    [VeilNativeTest]::SetWindowPos($handle,[IntPtr]::Zero,0,0,0,0,0x13) | Out-Null
    [VeilNativeTest]::SetForegroundWindow($handle) | Out-Null
  }
  'Raise' {
    [VeilNativeTest]::ShowWindow($handle,9) | Out-Null
    [VeilNativeTest]::SetWindowPos($handle,[IntPtr](-1),0,0,0,0,0x13) | Out-Null
    [VeilNativeTest]::SetWindowPos($handle,[IntPtr](-2),0,0,0,0,0x13) | Out-Null
    [VeilNativeTest]::SetForegroundWindow($handle) | Out-Null
  }
  'Probe' {
    $client = New-Object VeilNativeTest+Point
    [VeilNativeTest]::ClientToScreen($handle, [ref]$client) | Out-Null
    [uint32]$color=0; [byte]$alpha=0; [uint32]$flags=0
    $layered = [VeilNativeTest]::GetLayeredWindowAttributes($handle, [ref]$color, [ref]$alpha, [ref]$flags)
    $style = [VeilNativeTest]::GetWindowLongPtr($handle, -20).ToInt64()
    [uint32]$affinity=0
    $affinityRead = [VeilNativeTest]::GetWindowDisplayAffinity($handle, [ref]$affinity)
    @{ x=$bounds.Left; y=$bounds.Top; clientX=$client.X; clientY=$client.Y; width=$bounds.Right-$bounds.Left; height=$bounds.Bottom-$bounds.Top; visible=[VeilNativeTest]::IsWindowVisible($handle); foreground=([VeilNativeTest]::GetForegroundWindow() -eq $handle); topmost=($style -band 8) -ne 0; clickThrough=($style -band 32) -ne 0; alpha=$alpha; layered=$layered; affinityRead=$affinityRead; affinity=$affinity } | ConvertTo-Json -Compress
  }
  'Click' { [VeilNativeTest]::Click($X,$Y) }
  'Drag' { [VeilNativeTest]::Drag($X,$Y,$ToX,$ToY) }
  'HoldDrag' { [VeilNativeTest]::HoldDrag($X,$Y,$ToX,$ToY,$OutputPath) }
  'Move' {
    $flags = if ($Width -gt 0 -and $Height -gt 0) { 0x14 } else { 0x15 }
    [VeilNativeTest]::SetWindowPos($handle,[IntPtr]::Zero,$X,$Y,$Width,$Height,$flags) | Out-Null
  }
  'Recover' { [VeilNativeTest]::Shortcut($false) }
  'CustomToggle' { [VeilNativeTest]::CustomShortcut([byte]$KeyCode) }
  'Toggle' { [VeilNativeTest]::Shortcut($true) }
  'Close' { [VeilNativeTest]::PostMessage($handle,0x10,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null }
  'Pixel' {
    $dc = [VeilNativeTest]::GetDC([IntPtr]::Zero)
    try {
      $pixel = [VeilNativeTest]::GetPixel($dc,$X,$Y)
      @{ r=($pixel -band 255); g=(($pixel -shr 8) -band 255); b=(($pixel -shr 16) -band 255) } | ConvertTo-Json -Compress
    } finally { [VeilNativeTest]::ReleaseDC([IntPtr]::Zero,$dc) | Out-Null }
  }
  'Capture' {
    Add-Type -AssemblyName System.Drawing
    $bitmap = New-Object System.Drawing.Bitmap(($bounds.Right-$bounds.Left),($bounds.Bottom-$bounds.Top))
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$bitmap.Size)
      $bitmap.Save($OutputPath,[System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
}
