// Programs and actionable documents: a file that the system, when opened, runs as a program, script, shortcut
// or installer, or hands to an application that does something (installs, mounts, changes settings). The
// viewer does not hand such files to the default app: it has no "Open in default app" button for them. The
// file itself is not touched: Obsidian's own file menu item stays as it is. No Obsidian and no DOM.

/** Obsidian 1.13.7 and 1.14.4, main.js: on Windows it asks "Run executable file?" before opening these. */
const OBSIDIAN_ASKS_WINDOWS = 'exe bat cmd ps1 com msi vbs js jse wsf wsh py pyw scr';
/** …and before these on macOS and Linux (plus an executable file without an extension). */
const OBSIDIAN_ASKS_UNIX = 'sh command csh ksh bash zsh fish desktop action workflow';
/**
 * Windows runs these itself, and Obsidian hands them to the system without asking: shortcuts and links (lnk,
 * url, pif, scf, appref-ms, settingcontent-ms, website, a pinned site), HTML and XAML apps and help (hta,
 * xbap, chm), registry (reg), applets and consoles (cpl, msc), WSH scripts (vbe, ws, wsc, sct), installers
 * and packages (msp, mst, msix, msixbundle, appx, appxbundle, application, appinstaller installs a package
 * from a link, msu is an update, ppkg a provisioning package, inf setup information with an "Install" item,
 * printerexport printers with their drivers), Excel add-in (xll), Java (jar, jnlp), troubleshooting pack
 * (diagcab), gadget (gadget).
 */
const WINDOWS =
  'lnk url pif scf appref-ms settingcontent-ms website hta xbap chm reg cpl msc vbe ws wsc sct msp mst msix ' +
  'msixbundle appx appxbundle application appinstaller msu ppkg inf printerexport xll jar jnlp diagcab gadget';
/**
 * Windows opens these and applies or mounts them: themes (theme, themepack, deskthemepack are applied on open
 * and can pull files from a remote server), library, search and search connector (library-ms, search-ms,
 * searchconnector-ms show someone else's folder as local), remote desktop (rdp connects to another computer
 * with access to disks and clipboard), internet connection settings (ins, isp), sandbox with its own logon
 * command (wsb), certificates (cer, crt, der, p7b, pfx, p12: the wizard installs trust), disk images (iso,
 * img, vhd, vhdx are mounted on open).
 */
const WINDOWS_APPLIES =
  'theme themepack deskthemepack library-ms search-ms searchconnector-ms rdp ins isp wsb ' +
  'cer crt der p7b pfx p12 iso img vhd vhdx';
/**
 * PowerShell: Obsidian asks about scripts (ps1), but modules, manifests, format files and consoles are loaded
 * by PowerShell itself.
 */
const POWERSHELL = 'psm1 psd1 ps1xml ps2 ps2xml psc1 psc2';
/**
 * macOS: app, installer, Terminal settings (they run a command), file and address links; preference pane and
 * screen saver (installed on open), configuration profile (mobileconfig installs trust and settings, on
 * iPhone too), disk image (dmg is mounted on open).
 */
const MACOS = 'app pkg mpkg tool terminal fileloc webloc inetloc prefpane saver mobileconfig dmg';
/** Linux and Android: self-running files and packages. */
const LINUX = 'appimage run deb rpm snap flatpak flatpakref apk';
/**
 * Scripts that their interpreter runs if installed: Python, Perl, Ruby (rbw without a window), Tcl,
 * AutoHotkey (ahk), AutoIt (au3).
 */
const SCRIPTS = 'pyz pyzw pyc pyo pl rb rbw tcl ahk au3';

const PROGRAM = new Set(
  [OBSIDIAN_ASKS_WINDOWS, OBSIDIAN_ASKS_UNIX, WINDOWS, WINDOWS_APPLIES, POWERSHELL, MACOS, LINUX, SCRIPTS]
    .join(' ')
    .split(' '),
);

/**
 * The system may run a file named `name` (or at that path) as a program or open it as an action. The
 * extension is the last one (`report.pdf.exe` is a program), case-insensitive; trailing dots and spaces are
 * dropped, because Windows drops them itself and would open `setup.exe.` as `setup.exe`. No extension also
 * means yes: on macOS and Linux such a file may be a program.
 */
export function mayRunAsProgram(name: string): boolean {
  const file = name.slice(name.lastIndexOf('/') + 1).replace(/[.\s]+$/u, '');
  const dot = file.lastIndexOf('.');
  if (dot < 0) return true;
  return PROGRAM.has(file.slice(dot + 1).toLowerCase());
}
