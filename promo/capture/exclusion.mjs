// Capture-exclusion check with a known background. A slide window is pinned exactly
// under the overlay, Windows confirms the overlay is the top window at that spot, then
// ffmpeg's GDI capture grabs the region. Results are kept only if every grabbed pixel
// matches the slide (so nothing else on the desktop can leak into the media).
import { execFileSync, spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runDirectory, shutdown, sleep, startApp, waitFor } from './lib.mjs';

const output = resolve(import.meta.dirname, '../public/capture');
const directory = await runDirectory();
const win32 = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [StructLayout(LayoutKind.Sequential)] public struct P { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(P p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[W]::SetProcessDPIAware() | Out-Null
`;
const ps = (script) =>
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', win32 + script], {
    encoding: 'utf8',
  }).trim();

function rmse(a, b) {
  try {
    execFileSync('magick', ['compare', '-metric', 'RMSE', a, b, 'null:'], { stdio: 'pipe' });
    return 0;
  } catch (error) {
    // compare exits 1 when images differ and prints "abs (normalized)" on stderr.
    const match = String(error.stderr).match(/\(([\d.e-]+)\)/);
    return match ? Number(match[1]) : 1;
  }
}

let viewer;
const files = ['exclusion-gdigrab.png', 'exclusion-gdigrab.mp4', 'exclusion-last.png'].map((name) =>
  resolve(output, name),
);
try {
  const alex = await startApp(directory, 'alex');
  await alex.page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = alex.page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('textbox', { name: 'Your name' }).fill('Alex');
  await settings.getByRole('radio', { name: 'Dark', exact: true }).click();
  await settings.getByRole('button', { name: 'Close Settings' }).click();
  await alex.page.getByRole('button', { name: /^New document Start writing/ }).click();
  await alex.page.getByRole('textbox', { name: 'Document title' }).fill('Launch day');
  await alex.page.getByRole('textbox', { name: 'Shared document' }).click();
  await alex.page.keyboard.type('## Talking points\n- Open with the demo\nQuestions at the end\n', {
    delay: 5,
  });
  await alex.page.getByRole('button', { name: 'Show overlay' }).click();
  await waitFor(async () => Boolean(alex.overlay()), 'overlay window');
  await sleep(1000);
  const overlay = alex.overlay();
  const rect = await overlay.evaluate(() => ({
    x: screenX,
    y: screenY,
    width: outerWidth,
    height: outerHeight,
    dpr: devicePixelRatio,
  }));
  const pad = 60;
  const s = rect.dpr;
  const region = {
    x: Math.round((rect.x - pad) * s),
    y: Math.round((rect.y - pad) * s),
    width: Math.round((rect.width + pad * 2) * s) & ~1,
    height: Math.round((rect.height + pad * 2) * s) & ~1,
  };
  if (region.x < 0 || region.y < 0)
    throw new Error(`Overlay too close to the screen edge: ${JSON.stringify(rect)}`);

  const slide = resolve(directory, 'slide.png');
  execFileSync('magick', [
    '-size',
    `${region.width}x${region.height}`,
    'gradient:#22406f-#3a2458',
    '-font',
    'C:/Windows/Fonts/segoeuib.ttf',
    '-fill',
    'white',
    '-pointsize',
    String(Math.round(region.height / 9)),
    '-annotate',
    `+${Math.round(region.width / 14)}+${Math.round(region.height / 4)}`,
    'Q4 roadmap',
    '-font',
    'C:/Windows/Fonts/segoeui.ttf',
    '-fill',
    '#ffffffb0',
    '-pointsize',
    String(Math.round(region.height / 20)),
    '-annotate',
    `+${Math.round(region.width / 14)}+${Math.round(region.height / 2.7)}`,
    'Ship the overlay · Grow sharing',
    slide,
  ]);
  viewer = spawn(
    'ffplay',
    ['-loglevel', 'error', '-noborder', '-window_title', 'veil-capture-slide', '-loop', '0', slide],
    {
      stdio: 'ignore',
    },
  );
  // Pin the slide window topmost at the exact region (physical pixels).
  ps(`
$p = $null
for ($i = 0; $i -lt 80 -and -not $p; $i++) {
  Start-Sleep -Milliseconds 100
  $p = Get-Process ffplay -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'veil-capture-slide' } | Select-Object -First 1
}
if (-not $p) { throw 'slide window not found' }
[W]::SetWindowPos($p.MainWindowHandle, [IntPtr](-1), ${region.x}, ${region.y}, ${region.width}, ${region.height}, 0x40) | Out-Null
`);
  await sleep(600);
  // Re-show the overlay so it is raised above the pinned slide.
  await alex.page.getByRole('button', { name: 'Hide overlay' }).click();
  await sleep(600);
  await alex.page.getByRole('button', { name: 'Show overlay' }).click();
  await sleep(1200);
  const probe = (px, py) =>
    ps(`
$pt = New-Object W+P; $pt.X = ${px}; $pt.Y = ${py}
$h = [W]::GetAncestor([W]::WindowFromPoint($pt), 2)
$id = 0; [W]::GetWindowThreadProcessId($h, [ref]$id) | Out-Null
(Get-Process -Id $id).ProcessName
`);
  const centre = probe(
    Math.round((rect.x + rect.width / 2) * s),
    Math.round((rect.y + rect.height / 2) * s),
  );
  const margin = probe(region.x + 10, region.y + 10);
  console.log(`top window at overlay centre: ${centre}; in margin: ${margin}`);
  if (centre !== 'veil-desktop' || margin !== 'ffplay') {
    throw new Error('Overlay is not on top of the known slide; not capturing.');
  }

  await sleep(800);
  const recording = spawn(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'gdigrab',
      '-framerate',
      '30',
      '-offset_x',
      String(region.x),
      '-offset_y',
      String(region.y),
      '-video_size',
      `${region.width}x${region.height}`,
      '-t',
      '3',
      '-i',
      'desktop',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '16',
      files[1],
    ],
    { stdio: 'ignore' },
  );
  await sleep(500);
  const current = alex.overlay();
  await current.getByRole('textbox', { name: 'Shared document' }).click();
  await current.keyboard.press('Control+End');
  await current.keyboard.type(' Typed in the overlay.', { delay: 60 });
  await new Promise((done) => recording.once('exit', done));
  // The overlay is still on top after the recording.
  const after = probe(
    Math.round((rect.x + rect.width / 2) * s),
    Math.round((rect.y + rect.height / 2) * s),
  );
  // Check frames across the recording (start, middle while typing, end) against the slide.
  const diffs = [];
  for (const [index, at] of ['0.05', '1.5', '2.9'].entries()) {
    const target = index === 2 ? files[2] : files[0];
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      at,
      '-i',
      files[1],
      '-frames:v',
      '1',
      target,
    ]);
    diffs.push(rmse(target, slide));
  }
  await rm(files[0], { force: true });
  console.log(`RMSE vs slide at 0s/1.5s/2.9s: ${diffs.join(', ')}; top after: ${after}`);
  const stillDiff = Math.max(...diffs);
  const lastDiff = diffs[2];
  if (after !== 'veil-desktop' || stillDiff > 0.03) {
    throw new Error('Grabbed region does not match the known slide; discarding.');
  }
  await alex.overlay().screenshot({ path: resolve(output, 'exclusion-overlay.png') });
  await writeFile(
    resolve(output, 'exclusion.json'),
    JSON.stringify({ rect, region, pad, stillDiff, lastDiff }, null, 2),
  );
  console.log('Verified: the overlay was on top, and GDI capture recorded only the slide.');
} catch (error) {
  for (const file of files) await rm(file, { force: true });
  console.error(`Exclusion check failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  viewer?.kill();
  // The shim's child owns the window; stop only the slide viewer by its unique title.
  try {
    ps(
      `Get-Process ffplay -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'veil-capture-slide' } | Stop-Process -Force`,
    );
  } catch {
    // The viewer already exited.
  }
  await shutdown();
}
