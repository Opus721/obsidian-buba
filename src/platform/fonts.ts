// Installs font files for the current user, as "Install" in Windows Explorer does without administrator
// rights (Windows 10 1809 and later): the file goes to `%LOCALAPPDATA%\Microsoft\Windows\Fonts`, its value
// to `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts`, `AddFontResourceW` loads it and
// `WM_FONTCHANGE` tells open programs, so the font is in their lists at once, not after signing in again. A
// font whose registry name is already there, for the user or for all users, is left as it is ("exists"), as
// Explorer would ask to replace it. One fixed PowerShell script does a whole batch; the paths and names are
// handed to it as JSON in an environment variable, never as command text, and no shell runs it. macOS: the
// file goes to `~/Library/Fonts` (Font Book's "Install" for the user); Linux: `~/.local/share/fonts`, then
// `fc-cache`. Node comes through `window.require` behind a platform check: the plugin also loads on phones.
// What a font file is and its name: src/core/actions/font-install.ts.
import { Platform } from 'obsidian';
import type { FontOutcome } from '../core/actions/font-install.ts';

/** One font to install: full disk path of the vault file, its file name, its registry value name. */
export interface FontJob {
  readonly from: string;
  readonly file: string;
  readonly name: string;
}

type Fs = typeof import('node:fs/promises');
type ChildProcess = typeof import('node:child_process');
type Os = typeof import('node:os');
type Path = typeof import('node:path');

interface NodeParts {
  fs: Fs;
  child: ChildProcess;
  os: Os;
  path: Path;
}

function node(): NodeParts | null {
  if (!Platform.isDesktopApp) return null;
  try {
    return {
      fs: window.require('node:fs/promises') as Fs,
      child: window.require('node:child_process') as ChildProcess,
      os: window.require('node:os') as Os,
      path: window.require('node:path') as Path,
    };
  } catch {
    return null;
  }
}

/** Whether fonts can be installed here: the desktop app on Windows, macOS or Linux. */
export function fontInstallAvailable(): boolean {
  return node() !== null && (Platform.isWin || Platform.isMacOS || Platform.isLinux);
}

/** Installs the fonts one by one; the outcomes are in the order of `jobs`. */
export async function installFontFiles(jobs: readonly FontJob[]): Promise<FontOutcome[]> {
  const parts = node();
  if (!parts || !jobs.length) return jobs.map(() => 'failed');
  if (Platform.isWin) return installOnWindows(parts, jobs);
  const home = parts.os.homedir();
  const dir = Platform.isMacOS
    ? parts.path.join(home, 'Library', 'Fonts')
    : parts.path.join(home, '.local', 'share', 'fonts');
  const outcomes = await copyInto(parts, dir, jobs);
  if (Platform.isLinux && outcomes.includes('installed'))
    await new Promise<void>((done) => parts.child.execFile('fc-cache', ['-f', dir], () => done()));
  return outcomes;
}

/** macOS and Linux: a font with the same file name in the user's fonts folder is already installed. */
async function copyInto(parts: NodeParts, dir: string, jobs: readonly FontJob[]): Promise<FontOutcome[]> {
  const outcomes: FontOutcome[] = [];
  try {
    await parts.fs.mkdir(dir, { recursive: true });
  } catch (error) {
    console.error('Buba: fonts folder not made', dir, error);
    return jobs.map(() => 'failed');
  }
  for (const job of jobs) {
    const to = parts.path.join(dir, parts.path.basename(job.file));
    try {
      // COPYFILE_EXCL: an existing file is never overwritten.
      await parts.fs.copyFile(job.from, to, parts.fs.constants.COPYFILE_EXCL);
      outcomes.push('installed');
    } catch (error) {
      if ((error as { code?: string }).code === 'EEXIST') outcomes.push('exists');
      else {
        console.error('Buba: font not installed', job.from, error);
        outcomes.push('failed');
      }
    }
  }
  return outcomes;
}

/**
 * The whole Windows install as one PowerShell script. Input: `$env:BUBA_FONTS`, a JSON list of
 * `{ from, file, name }`; output: a JSON list of outcomes in the same order. A file name taken in the
 * user's fonts folder by another font gets a free one, "name_1.ttf", as Explorer does.
 */
const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
# PowerShell's own progress records (module setup on first use) would reach stderr as CLIXML.
$ProgressPreference = 'SilentlyContinue'
$items = ConvertFrom-Json -InputObject $env:BUBA_FONTS
Add-Type -Namespace Buba -Name Fonts -MemberDefinition @'
[DllImport("gdi32.dll", CharSet = CharSet.Unicode)] public static extern int AddFontResourceW(string file);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeoutW(IntPtr hwnd, uint msg, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
'@
$dir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$userKey = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'
if (-not (Test-Path -LiteralPath $userKey)) { New-Item -Path $userKey -Force | Out-Null }
$user = Get-Item -LiteralPath $userKey
$machine = Get-Item -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts'
$out = @()
$changed = $false
foreach ($item in $items) {
  try {
    if ($null -ne $user.GetValue($item.name) -or $null -ne $machine.GetValue($item.name)) { $out += 'exists'; continue }
    $base = [IO.Path]::GetFileNameWithoutExtension($item.file)
    $ext = [IO.Path]::GetExtension($item.file)
    $to = Join-Path $dir ($base + $ext)
    $n = 0
    while (Test-Path -LiteralPath $to) { $n++; $to = Join-Path $dir ($base + '_' + $n + $ext) }
    Copy-Item -LiteralPath $item.from -Destination $to
    New-ItemProperty -LiteralPath $userKey -Name $item.name -Value $to -PropertyType String -Force | Out-Null
    [void][Buba.Fonts]::AddFontResourceW($to)
    $changed = $true
    $out += 'installed'
  } catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    $out += 'failed'
  }
}
if ($changed) {
  $result = [UIntPtr]::Zero
  [void][Buba.Fonts]::SendMessageTimeoutW([IntPtr]0xffff, 0x001D, [UIntPtr]::Zero, [IntPtr]::Zero, 2, 1000, [ref]$result)
}
ConvertTo-Json -Compress -InputObject @($out)
`;

function installOnWindows(parts: NodeParts, jobs: readonly FontJob[]): Promise<FontOutcome[]> {
  // UTF-16LE base64, as `-EncodedCommand` takes it: no quoting of the script on the command line.
  const encoded = Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64');
  const env = { ...process.env, BUBA_FONTS: JSON.stringify(jobs) };
  return new Promise((done) => {
    parts.child.execFile(
      // By full path: Windows looks for a bare name in the current folder before PATH (review 28.10).
      parts.path.join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { env, windowsHide: true, timeout: 120_000 },
      (error, stdout, stderr) => {
        const outcomes = parseOutcomes(stdout, jobs.length);
        // The script writes a failed font's reason to stderr; anything there without a failure is noise.
        if (!outcomes || outcomes.includes('failed'))
          console.error('Buba: font install', error ?? '', stderr.trim());
        done(outcomes ?? jobs.map(() => 'failed'));
      },
    );
  });
}

/** The script's JSON list, or `null` when it is not one outcome per job. */
function parseOutcomes(stdout: string, count: number): FontOutcome[] | null {
  try {
    const list: unknown = JSON.parse(stdout.trim());
    if (!Array.isArray(list) || list.length !== count) return null;
    return (list as unknown[]).map((each): FontOutcome =>
      each === 'installed' || each === 'exists' ? each : 'failed',
    );
  } catch {
    return null;
  }
}
