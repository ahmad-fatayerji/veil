// Optional isolated OBS fixture. Never uses the user's profiles, scenes or stream settings.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
export async function recordObs(portableRoot, directory, mode, phase, bounds) {
  const taskRelative = relative(resolve(import.meta.dirname, '../target'), portableRoot);
  assert.ok(
    taskRelative && !taskRelative.startsWith('..') && !isAbsolute(taskRelative),
    'Use a disposable OBS copy inside this worktree target directory.',
  );
  await writeFile(resolve(portableRoot, 'portable_mode.txt'), '');
  const config = resolve(portableRoot, 'config/obs-studio');
  const output = resolve(directory, `obs-${mode}-${phase}`);
  await mkdir(output, { recursive: true });
  await mkdir(resolve(config, 'basic/profiles/M4'), { recursive: true });
  await mkdir(resolve(config, 'basic/scenes'), { recursive: true });
  const size = JSON.parse(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; $taskScreen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; @{ width=$taskScreen.Width; height=$taskScreen.Height } | ConvertTo-Json -Compress',
      ],
      { windowsHide: true, encoding: 'utf8' },
    ),
  );
  const global =
    '[General]\nFirstRun=true\nConfirmOnExit=false\nEnableAutoUpdates=false\nLastVersion=536870912\n[Basic]\nProfile=M4\nProfileDir=M4\nSceneCollection=M4\nSceneCollectionFile=M4\n';
  await writeFile(resolve(config, 'global.ini'), global);
  await writeFile(resolve(config, 'user.ini'), global);
  await writeFile(
    resolve(config, 'basic/profiles/M4/basic.ini'),
    `[General]\nName=M4\n[Video]\nBaseCX=${bounds.width}\nBaseCY=${bounds.height}\nOutputCX=${bounds.width}\nOutputCY=${bounds.height}\nFPSCommon=10\nFPSType=0\n[Output]\nMode=Simple\nFilenameFormatting=%CCYY-%MM-%DD %hh-%mm-%ss\n[SimpleOutput]\nFilePath=${output.replaceAll('\\', '/')}\nRecFormat=mkv\nRecFormat2=mkv\nRecQuality=Small\nRecEncoder=x264\nStreamEncoder=x264\nVBitrate=10000\n[Audio]\nSampleRate=48000\nChannelSetup=Stereo\n`,
  );
  const sourceUuid = randomUUID();
  await writeFile(
    resolve(config, 'basic/scenes/M4.json'),
    JSON.stringify({
      name: 'M4',
      current_scene: 'M4',
      current_program_scene: 'M4',
      scene_order: [{ name: 'M4' }],
      sources: [
        {
          name: 'Desktop',
          uuid: sourceUuid,
          id: 'monitor_capture',
          versioned_id: 'monitor_capture',
          settings: {
            method: mode === 'dxgi' ? 1 : 2,
            monitor_id: '\\\\.\\DISPLAY1',
            capture_cursor: false,
          },
          enabled: true,
          volume: 1,
        },
        {
          name: 'M4',
          uuid: randomUUID(),
          id: 'scene',
          versioned_id: 'scene',
          settings: {
            items: [
              {
                name: 'Desktop',
                source_uuid: sourceUuid,
                visible: true,
                locked: false,
                rot: 0,
                pos: { x: 0, y: 0 },
                scale: { x: 1, y: 1 },
                align: 5,
                bounds_type: 0,
                bounds_align: 0,
                bounds: { x: 0, y: 0 },
                crop_left: bounds.x,
                crop_top: bounds.y,
                crop_right: size.width - bounds.x - bounds.width,
                crop_bottom: size.height - bounds.y - bounds.height,
                id: 1,
              },
            ],
          },
        },
      ],
    }),
  );
  // Explicitly disable OBS's network control plugin; no listening service is needed.
  await mkdir(resolve(config, 'plugin_config/obs-websocket'), { recursive: true });
  await writeFile(
    resolve(config, 'plugin_config/obs-websocket/config.json'),
    JSON.stringify({ server_enabled: false, alerts_enabled: false, first_load: false }),
  );
  const obs = spawn(
    resolve(portableRoot, 'bin/64bit/obs64.exe'),
    [
      '--portable',
      '--profile',
      'M4',
      '--collection',
      'M4',
      '--startrecording',
      '--minimize-to-tray',
      '--disable-shutdown-check',
      '--disable-updater',
      '--only-bundled-plugins',
    ],
    { cwd: resolve(portableRoot, 'bin/64bit'), windowsHide: true, stdio: 'ignore' },
  );
  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      if ((await readdir(output)).some((file) => file.endsWith('.mkv'))) break;
      if (obs.exitCode !== null) throw new Error(`OBS exited early: ${obs.exitCode}`);
      await delay(250);
    }
    await delay(2500);
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class VeilObsClose {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  public static void Close(uint target) { EnumWindows((hwnd,p) => { uint pid; GetWindowThreadProcessId(hwnd,out pid); var text=new System.Text.StringBuilder(512); GetWindowText(hwnd,text,512); if(pid==target && text.ToString().StartsWith("OBS")) PostMessage(hwnd,0x10,IntPtr.Zero,IntPtr.Zero); return true; },IntPtr.Zero); }
}
'@
[VeilObsClose]::Close(${obs.pid})
`,
      ],
      { windowsHide: true, timeout: 10000 },
    );
    for (let attempt = 0; attempt < 60 && obs.exitCode === null; attempt++) await delay(250);
    if (obs.exitCode === null) throw new Error('Isolated OBS did not close cleanly.');
    const recording = (await readdir(output)).find((file) => file.endsWith('.mkv'));
    if (!recording) throw new Error('OBS did not produce a recording.');
    const logs = (await readdir(resolve(config, 'logs')))
      .filter((file) => file.endsWith('.txt'))
      .sort();
    const log = await readFile(resolve(config, 'logs', logs.at(-1)), 'utf8');
    await writeFile(resolve(output, 'obs.log'), log);
    if (!log.includes(`method: ${mode === 'dxgi' ? 'DXGI' : 'WGC'}`))
      throw new Error('OBS capture method was not confirmed in its log.');
    return resolve(output, recording);
  } finally {
    if (obs.exitCode === null) obs.kill();
  }
}
