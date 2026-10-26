// Format family of a file by extension: the label color and Lucide icon of a tile without a preview (also PSD
// and AI without an embedded thumbnail) and the icon of the file panel's preview section. Lucide has no
// application icons and drawing them is not allowed (trademarks), so a family Lucide icon and the format
// label in the family color stand in for them. An application color is its brand `#rrggbb`; where it gives
// the label less than 4.5:1 in the dark theme (Resolve, Steinberg, Word, Excel, PowerPoint), lightness is
// raised in OKLCh at the same hue. Archives and fonts use Obsidian theme presets (`--color-<name>`); the rest
// are neutral (src/core/color/value.ts, `colorCss`). Icons come from Obsidian's Lucide set: `setIcon`
// silently draws nothing for an unknown name and silently swaps an old name from Obsidian's alias map
// (`presentation` becomes a monitor), so such names are written with `lucide-`. In the grid's document
// silhouette (src/assets/grid/file-tiles.css) a family may show short letters instead of the icon (`mark`:
// "Ps", "Ae"…), set as text in Buba's own document shape: an abbreviation of the format, not the
// application's logo, which is still never drawn. No `obsidian` import.
import { luminance } from '../color/contrast.ts';
import { PRESET_COLORS, type ColorValue } from '../color/value.ts';

export type FormatFamilyId =
  | 'photoshop'
  | 'raw'
  | 'illustrator'
  | 'indesign'
  | 'figma'
  | 'sketch'
  | 'motion'
  | 'premiere'
  | 'edit'
  | 'blender'
  | 'c4d'
  | 'autodesk'
  | '3d'
  | 'daw'
  | 'flstudio'
  | 'protools'
  | 'cubase'
  | 'pdf'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'archive'
  | 'font'
  | 'key'
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  | 'canvas'
  | 'base'
  | 'service'
  | 'other';

/** How a tile of this format looks without a preview. */
export interface FormatFamily {
  readonly family: FormatFamilyId;
  /** A Lucide icon from Obsidian's set. */
  readonly icon: string;
  /** Application `#rrggbb` or an Obsidian theme preset; `null` is a neutral label in the text color. */
  readonly color: ColorValue | null;
  /** Letters on the document silhouette instead of the icon; absent means the icon. */
  readonly mark?: string;
}

/**
 * Families: icon, color and lowercase extensions. Each single-application family has its own icon; Photoshop
 * and RAW (Lightroom) share one blue. Editing is one family for DaVinci Resolve, Final Cut, Avid and Vegas:
 * scissors and the Resolve color. 3D exchange formats and projects of applications without one brand color
 * (Ableton, Reaper…) are neutral with their own icon. Keys and certificates (e.g. `.ovpn`) are neutral with a
 * key icon; `key` is not among them because it is also a Keynote file. Service files of applications
 * (Premiere caches and lock, XMP) are neutral with a service-file icon.
 */
const TABLE: readonly (FormatFamily & { readonly exts: string })[] = [
  { family: 'photoshop', icon: 'file-image', color: '#31a8ff', mark: 'Ps', exts: 'psd psb' },
  {
    family: 'raw',
    icon: 'aperture',
    color: '#31a8ff',
    exts: '3fr ari arw braw cr2 cr3 crw dcr dng erf fff gpr iiq kdc mef mos mrw nef nrw orf pef r3d raf raw rw2 rwl sr2 srf srw x3f',
  },
  { family: 'illustrator', icon: 'pen-tool', color: '#ff9a00', mark: 'Ai', exts: 'ai ait eps' },
  { family: 'indesign', icon: 'newspaper', color: '#ff3366', mark: 'Id', exts: 'indd indt idml' },
  { family: 'figma', icon: 'frame', color: '#f24e1e', exts: 'fig' },
  { family: 'sketch', icon: 'gem', color: '#f7b500', exts: 'sketch' },
  { family: 'motion', icon: 'film', color: '#9999ff', mark: 'Ae', exts: 'aep aepx aet mogrt ffx' },
  { family: 'premiere', icon: 'clapperboard', color: '#e67bff', mark: 'Pr', exts: 'prproj' },
  { family: 'edit', icon: 'scissors', color: '#6a839e', exts: 'drp drt fcpxml avb avp veg edl aaf' },
  { family: 'blender', icon: 'torus', color: '#e87d0d', exts: 'blend blend1' },
  { family: 'c4d', icon: 'cone', color: '#6a77ea', exts: 'c4d' },
  { family: 'autodesk', icon: 'cylinder', color: '#37a5cc', exts: 'ma mb max' },
  {
    family: '3d',
    icon: 'box',
    color: null,
    exts: 'fbx obj mtl 3ds dae abc gltf glb usd usda usdc usdz stl ply hip hipnc hiplc ztl zpr spp sbs sbsar skp 3dm',
  },
  { family: 'daw', icon: 'sliders-vertical', color: null, exts: 'als rpp song sesx aup3 aup' },
  { family: 'flstudio', icon: 'drum', color: '#f28a1e', exts: 'flp' },
  { family: 'protools', icon: 'audio-waveform', color: '#7acb10', exts: 'ptx ptf' },
  { family: 'cubase', icon: 'piano', color: '#ea3a42', exts: 'cpr npr' },
  { family: 'pdf', icon: 'file-text', color: '#fa0f00', exts: 'pdf' },
  { family: 'word', icon: 'file-pen-line', color: '#5381c7', mark: 'W', exts: 'doc docx odt rtf' },
  { family: 'excel', icon: 'file-spreadsheet', color: '#408e5f', mark: 'X', exts: 'xls xlsx xlsm ods csv' },
  { family: 'powerpoint', icon: 'lucide-presentation', color: '#dd5130', mark: 'P', exts: 'ppt pptx odp' },
  { family: 'archive', icon: 'file-archive', color: 'yellow', exts: 'zip rar 7z tar gz tgz bz2 xz' },
  { family: 'font', icon: 'file-type', color: 'pink', exts: 'ttf otf ttc woff woff2' },
  { family: 'key', icon: 'file-key', color: null, exts: 'ovpn pem crt cer p12 pfx' },
  {
    family: 'image',
    icon: 'image',
    color: null,
    exts: 'png jpg jpeg gif webp bmp svg avif heic heif tif tiff ico exr hdr tga dds jxl jfif',
  },
  {
    family: 'video',
    icon: 'film',
    color: null,
    exts: 'mp4 webm mov mkv avi m4v ogv mxf mts m2ts mpg mpeg wmv flv',
  },
  {
    family: 'audio',
    icon: 'music',
    color: null,
    exts: 'mp3 wav flac ogg m4a aac opus oga 3gp aif aiff wma mid midi',
  },
  { family: 'text', icon: 'file-text', color: null, exts: 'md txt' },
  { family: 'canvas', icon: 'layout-dashboard', color: null, exts: 'canvas' },
  { family: 'base', icon: 'layout-list', color: null, exts: 'base' },
  { family: 'service', icon: 'file-cog', color: null, exts: 'cfa pek prlock xmp' },
];

const OTHER: FormatFamily = { family: 'other', icon: 'file', color: null };

const BY_EXT = new Map<string, FormatFamily>(
  TABLE.flatMap(({ family, icon, color, mark, exts }) => {
    const look: FormatFamily = mark === undefined ? { family, icon, color } : { family, icon, color, mark };
    return exts.split(' ').map((ext) => [ext, look] as const);
  }),
);

/**
 * All extensions of the table, lowercase, as written, without deduplication: a test sees an extension
 * repeated in two families here, while in `BY_EXT` the later family would silently override the earlier one.
 */
export const FORMAT_EXTENSIONS: readonly string[] = TABLE.flatMap(({ exts }) => exts.split(' '));

/** Family by extension, case-insensitive; unknown and empty are neutral with a file icon. */
export function formatFamily(ext: string): FormatFamily {
  return BY_EXT.get(ext.toLowerCase()) ?? OTHER;
}

/** Longer unknown extensions are cut: the badge shows a format, not the tail of a name. */
const LABEL_MAX = 5;

/**
 * Badge text: the extension in uppercase. Known ones are shown whole (the longest are 6 characters: `CANVAS`,
 * `PRPROJ`); unknown ones up to 5 characters, longer ones as 4 characters and "…". Characters are counted by
 * code point so an emoji is not split in half.
 */
export function formatLabel(ext: string): string {
  const label = ext.toUpperCase();
  if (BY_EXT.has(ext.toLowerCase())) return label;
  const chars = [...label];
  return chars.length <= LABEL_MAX ? label : `${chars.slice(0, LABEL_MAX - 1).join('')}…`;
}

/** Light presets: dark letters read on them (Obsidian 1.14: yellow, green, cyan, pink). */
const LIGHT_PRESETS = new Set(['yellow', 'green', 'cyan', 'pink']);

/**
 * Letters and icon on a filled document silhouette: white, or dark on a light fill (relative luminance above
 * 0.5: Sketch yellow, light presets). A neutral family has no fill of its own and takes the theme text color.
 */
export function formatInk(color: ColorValue | null): 'light' | 'dark' | 'theme' {
  if (color === null) return 'theme';
  if ((PRESET_COLORS as readonly string[]).includes(color))
    return LIGHT_PRESETS.has(color) ? 'dark' : 'light';
  return luminance(color as `#${string}`) > 0.5 ? 'dark' : 'light';
}
