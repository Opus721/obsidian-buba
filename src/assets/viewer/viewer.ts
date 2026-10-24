// Full-window viewer of a file's original from a given list. Wheel zooms toward the cursor, the middle button
// pans with free margin around, arrows go to neighboring files, Esc closes (as for any Obsidian Modal). Zoom
// and pan math is in core (src/core/viewer/zoom.ts). SVG only through <img>, the file name only as text. A
// file Obsidian opens itself gets an "Open" button; a file without its own Obsidian view gets "Open in
// default app", or "Share" on iPhone, except programs, scripts and shortcuts. On touch, pinch and double-tap
// zoom the image and a zoomed image pans by finger, as in Obsidian's image viewer (src/core/viewer/pinch.ts),
// but pinch edges are soft and spring back on release; when the stage resizes (phone rotation, desktop
// window) the frame is recomputed. Swipe down closes the viewer for an unzoomed image, and for a zoomed one
// when its top is at the stage top, like iPhone Photos. On phones a swipe from the right edge closes the
// viewer and slides out the "File panel" with this file through a workspace event (src/core/viewer/edge.ts);
// in landscape also from the very screen edge, inside the safe area border. Phones also get "previous" and
// "next" buttons at mid-height styled like Obsidian's close button: they page like the arrow keys, with no
// arrow at the list edge, and a touch starting on them starts no viewer gesture. A finger that left the
// screen without a release event (WebKit on iOS) is dropped by the gestures through the cancel path. While a
// gesture holds a touch the viewer cancels touchmove and iOS gestures, and stage and image touches go to the
// viewer (`touch-action: none`, viewer.css), otherwise iPhone takes the finger. On phones a single tap on
// the image or video hides the close button, "Fit to screen" and the arrows, the next tap shows them, like
// iPhone Photos (src/core/viewer/tap.ts); another file shows them again.
import { ButtonComponent, Modal, Platform, setIcon, type App, type TFile } from 'obsidian';
import { formatFamily } from '../../core/format/family.ts';
import { AUDIO_EXTS, IMAGE_EXTS, OWN_VIEW_EXTS, VIDEO_EXTS } from '../../core/format/obsidian-types.ts';
import { ANDROID_BACK_PX, EdgeSwipe, FILE_PANEL, atRightEdge, drawerWidth } from '../../core/viewer/edge.ts';
import { mayRunAsProgram } from '../../core/viewer/executable.ts';
import { t } from '../../core/i18n/dict/viewer.ts';
import {
  fitView,
  neighbor,
  panBy,
  wheelFactor,
  zoomAt,
  type Point,
  type Size,
  type ViewState,
} from '../../core/viewer/zoom.ts';
import {
  DOUBLE_TAP_MS,
  MOMENTUM_FIRST_MS,
  TouchZoom,
  ZOOM_MS,
  atTopEdge,
  clampView,
  momentumStep,
  refitView,
  type Frame,
  type ZoomEnd,
} from '../../core/viewer/pinch.ts';
import {
  BACK_MS,
  DismissSwipe,
  dismissFade,
  ease,
  flyMs,
  flyTo,
  inVideoBar,
} from '../../core/viewer/swipe.ts';
import { CONTROLS_FADE_MS, TapToggle } from '../../core/viewer/tap.ts';
import './viewer.css';

const IMAGE = IMAGE_EXTS;
const VIDEO = VIDEO_EXTS;
/**
 * What Obsidian opens in its own views and the viewer does not show: notes, canvases, bases, PDFs and audio,
 * by Obsidian's lists (src/core/format/obsidian-types.ts); `webm` is video, as in the viewer. Obsidian opens
 * images and video too, but the viewer shows those.
 */
const IN_OBSIDIAN: ReadonlySet<string> = new Set([...OWN_VIEW_EXTS, ...AUDIO_EXTS]);

/** Whether Obsidian, not the viewer, opens the file. */
export function opensInObsidian(file: TFile): boolean {
  return IN_OBSIDIAN.has(file.extension.toLowerCase());
}

/**
 * Whether file `name` has no own view in Obsidian and is not a program: the public `openFile` hands it to the
 * default app. Images and video have an Obsidian view, so `openFile` would open them in place of the grid
 * instead.
 */
function opensInDefaultApp(file: TFile, name: string): boolean {
  const ext = file.extension.toLowerCase();
  return !IN_OBSIDIAN.has(ext) && !IMAGE.has(ext) && !VIDEO.has(ext) && !mayRunAsProgram(name);
}

/**
 * Opens the viewer on `paths[index]` and returns the modal, so callers can add keys to its `scope`. Arrows
 * page through the same list. Paths are from the vault root.
 */
export function openViewer(app: App, paths: string[], index: number): Modal {
  const modal = new ViewerModal(app, paths, index);
  modal.open();
  return modal;
}

class ViewerModal extends Modal {
  readonly #paths: string[];
  readonly #fitButton: HTMLButtonElement;
  #index: number;
  /** The original on the stage, while loading and after. */
  #media: HTMLImageElement | HTMLVideoElement | null = null;
  /** Original size in window points; `null` until loaded, and zoom and pan wait for it. */
  #size: Size | null = null;
  #view: ViewState = { scale: 1, x: 0, y: 0 };
  #drag: { id: number; x: number; y: number } | null = null;
  /** Fit scale: whether the image is zoomed, for swipe down and the edge gesture. */
  #fitScale = 1;
  /** Fitted view and stage: pinch's 1× and the edge limits; recomputed when the stage resizes (`#refit`). */
  #fitView: ViewState = { scale: 1, x: 0, y: 0 };
  #box: Size = { width: 0, height: 0 };
  /** Stage size, observed from the first load of the original until the viewer closes. */
  #resize: ResizeObserver | null = null;
  /** Pinch, finger pan and double-tap: touch logic is in core, frames are here. */
  readonly #touchZoom = new TouchZoom();
  /** Target of the zoom animation (spring back, double-tap): a new touch snaps the image there at once. */
  #zoomTo: ViewState | null = null;
  #zoomFrame = 0;
  /** Pan momentum frame. */
  #glideFrame = 0;
  /** Swipe down on touch: touch logic is in core, here the stage offset, background and close button. */
  readonly #swipe = new DismissSwipe();
  /** Stage offset down, px; background and close button get this share. */
  #swipeOffset = 0;
  #swipeFade = 1;
  /**
   * Spring back or leave animation frame; `#leaving` means the image is leaving and the viewer will close.
   */
  #swipeFrame = 0;
  #leaving = false;
  /**
   * Swipe from the right edge on phones: touch logic is in core, here closing the viewer and calling the
   * panel.
   */
  readonly #edge = new EdgeSwipe();
  /** "Previous" and "next" buttons, phones only; `null` on desktop and tablet. */
  readonly #nav: { prev: HTMLElement; next: HTMLElement } | null;
  /** Document and window that listen for releases, hiding and focus loss; removed in `onClose`. */
  #lostOn: { doc: Document; win: Window } | null = null;
  /**
   * A single tap on phones hides and shows the viewer buttons: touch logic is in core, here the pause and
   * fading.
   */
  readonly #tap = new TapToggle();
  /** Double-tap pause timer; button fade frame; whether buttons are hidden and their visible share. */
  #tapTimer = 0;
  #controlsFrame = 0;
  #controlsHidden = false;
  #controlsShown = 1;

  constructor(app: App, paths: string[], index: number) {
    super(app);
    this.#paths = paths;
    this.#index = index;
    this.modalEl.addClass('buba-viewer');
    // "Fit to screen" is a round button with the `scan` icon and a tooltip label; styling in viewer.css.
    // Hidden with Obsidian's DOM `hide()`: the viewer buttons rule (`display: flex`) overrides the `hidden`
    // attribute.
    this.#fitButton = this.modalEl.createEl('button', {
      cls: 'buba-viewer-fit',
      attr: { type: 'button', 'aria-label': t('fitToScreen') },
    });
    setIcon(this.#fitButton, 'scan');
    this.#fitButton.hide();
    this.#fitButton.addEventListener('click', () => {
      if (!this.#size) return;
      this.#zoomStop();
      this.#swipeStop();
      this.#refit();
      this.#zoomAnimate(this.#fitView);
    });
    this.scope.register([], 'ArrowLeft', () => this.#step(-1));
    this.scope.register([], 'ArrowRight', () => this.#step(1));
    this.#nav = Platform.isPhone
      ? {
          prev: this.#navButton('mod-prev', 'lucide-chevron-left', t('previousFile'), -1),
          next: this.#navButton('mod-next', 'lucide-chevron-right', t('nextFile'), 1),
        }
      : null;

    // Listeners are added once per modal, so reopening the same modal does not double them. Wheel and middle
    // button are on the stage, touches on the modal (`#listenSwipe`).
    const stage = this.contentEl;
    stage.addEventListener('wheel', (evt) => this.#zoom(evt), { passive: false });
    // Middle button: without preventDefault on mousedown Windows starts autoscroll.
    stage.addEventListener('mousedown', (evt) => {
      if (evt.button === 1) evt.preventDefault();
    });
    stage.addEventListener('pointerdown', (evt) => {
      if (evt.button !== 1) return;
      this.#zoomStop();
      stage.setPointerCapture(evt.pointerId);
      this.#drag = { id: evt.pointerId, x: evt.clientX, y: evt.clientY };
    });
    stage.addEventListener('pointermove', (evt) => {
      const drag = this.#drag;
      if (!drag || drag.id !== evt.pointerId) return;
      this.#zoomStop();
      if (this.#size) this.#apply(panBy(this.#view, evt.clientX - drag.x, evt.clientY - drag.y));
      drag.x = evt.clientX;
      drag.y = evt.clientY;
    });
    const drop = (evt: PointerEvent) => {
      if (this.#drag?.id === evt.pointerId) this.#drag = null;
    };
    stage.addEventListener('pointerup', drop);
    stage.addEventListener('pointercancel', drop);
    this.#listenSwipe();
  }

  override onOpen(): void {
    this.#listenLost();
    this.#show();
  }

  override onClose(): void {
    this.#controlsReset();
    this.#unlistenLost();
    this.#resize?.disconnect();
    this.#resize = null;
    this.#release();
    this.contentEl.empty();
  }

  /**
   * "Previous" or "next" button on phones: the same element as Obsidian 1.14.4's modal close button
   * (`modal-header-button mod-raised clickable-icon`, app.js), with icons and labels like Obsidian's phone
   * back and forward navigation buttons. It is a child of the modal outside the stage, so a touch starting on
   * it starts no gesture (`#touchedAt`). Position and background in `viewer.css`.
   */
  #navButton(cls: string, icon: string, label: string, dir: -1 | 1): HTMLElement {
    const button = this.modalEl.createDiv({
      cls: `modal-header-button mod-raised clickable-icon buba-viewer-nav ${cls}`,
      attr: { role: 'button', 'aria-label': label },
    });
    setIcon(button, icon);
    button.addEventListener('click', () => this.#step(dir));
    return button;
  }

  /**
   * A button with nowhere to page is hidden: "previous" on the first file, "next" on the last, both for a
   * single file; at the list edge `#step` does nothing, so there is nothing to press. Hidden with Obsidian's
   * DOM `hide()`, i.e. `display: none` on the element itself: Obsidian's `.clickable-icon { display: flex }`
   * overrides the `hidden` attribute.
   */
  #updateNav(): void {
    const nav = this.#nav;
    if (!nav) return;
    const count = this.#paths.length;
    for (const [button, dir] of [
      [nav.prev, -1],
      [nav.next, 1],
    ] as const)
      if (neighbor(this.#index, count, dir) === this.#index) button.hide();
      else button.show();
  }

  /** Returns false so Obsidian swallows the key and it goes no further. */
  #step(dir: -1 | 1): false {
    const next = neighbor(this.#index, this.#paths.length, dir);
    if (next !== this.#index) {
      this.#index = next;
      this.#show();
    }
    return false;
  }

  #zoom(evt: WheelEvent): void {
    evt.preventDefault();
    if (!this.#size) return;
    this.#zoomStop();
    const box = this.contentEl.getBoundingClientRect();
    const point = { x: evt.clientX - box.left, y: evt.clientY - box.top };
    this.#apply(zoomAt(this.#view, wheelFactor(evt.deltaY), point));
  }

  /** Scale via element size, not `scale()`, so a video's controls keep their size at any zoom. */
  #apply(view: ViewState): void {
    this.#view = view;
    const size = this.#size;
    if (!this.#media || !size) return;
    this.#media.setCssStyles({
      width: `${size.width * view.scale}px`,
      height: `${size.height * view.scale}px`,
      transform: `translate(${view.x}px, ${view.y}px)`,
    });
  }

  #show(): void {
    this.#release();
    this.#controlsReset();
    this.contentEl.empty();
    this.#updateNav();
    const path = this.#paths[this.#index] ?? '';
    const file = this.app.vault.getFileByPath(path);
    const ext = file?.extension.toLowerCase() ?? '';
    // The image cannot be dragged away, neither by mouse nor by long press on iPhone, as in Obsidian's image
    // viewer.
    if (file && IMAGE.has(ext))
      this.#load(this.contentEl.createEl('img', { attr: { draggable: 'false' } }), 'load', file);
    else if (file && VIDEO.has(ext)) {
      // Inside the modal with its own controls: without playsinline iPhone plays video only fullscreen in the
      // system player.
      const video = this.contentEl.createEl('video', { attr: { controls: '', playsinline: '' } });
      this.#load(video, 'loadedmetadata', file);
      this.#play(video);
    } else this.#empty(path);
  }

  /**
   * Video plays at once, with sound. Called synchronously from `#show`, still inside the tap, click or key
   * that opened the viewer or paged with an arrow: WebKit on iPhone allows sound only on a user gesture
   * (https://webkit.org/blog/6784/new-video-policies-for-ios/). If sound is refused (`NotAllowedError`),
   * retry muted once; if that is refused too, the player's ▶ button remains. An `AbortError` from paging or
   * closing (the element is already off the stage) is swallowed. Every rejection is caught, so none reaches
   * the error log unhandled.
   */
  #play(video: HTMLVideoElement): void {
    video.play().catch((err: unknown) => {
      if (this.#media !== video || (err as { name?: unknown } | null)?.name !== 'NotAllowedError') return;
      video.muted = true;
      video.play().catch(() => {});
    });
  }

  /**
   * Until the original loads its size is unknown: the element is hidden, and fitted to the viewer on load.
   */
  #load(media: HTMLImageElement | HTMLVideoElement, ready: string, file: TFile): void {
    media.addClass('buba-viewer-media');
    media.hide();
    this.#media = media;
    media.addEventListener(ready, () => {
      if (this.#media !== media) return;
      media.show();
      // The original's own size; an image without dimensions (SVG with only a viewBox) gets the default size.
      this.#size = { width: media.offsetWidth, height: media.offsetHeight };
      const box = this.contentEl.getBoundingClientRect();
      this.#box = { width: box.width, height: box.height };
      this.#fitView = this.#fit(media, this.#size, this.#box);
      this.#apply(this.#fitView);
      this.#fitScale = this.#view.scale;
      this.#fitButton.show();
      this.#watchStage();
    });
    media.addEventListener('error', () => {
      if (this.#media !== media) return;
      this.#release();
      this.contentEl.empty();
      this.#empty(file.path);
    });
    media.src = this.app.vault.getResourcePath(file);
  }

  /**
   * Fits an original of `size` into the stage. On phones video goes into the part of the stage below the
   * close button: `viewer.css` sets the strip height in `--buba-viewer-video-top`, only under `.is-phone`;
   * iOS draws the player controls inside the video, and this keeps them clear of the close button. Images,
   * desktop and tablet use the whole stage.
   */
  #fit(media: HTMLImageElement | HTMLVideoElement, size: Size, box: Size): ViewState {
    const top = media.instanceOf(HTMLVideoElement) ? this.#videoTop(box.height) : 0;
    const view = fitView(size, { width: box.width, height: box.height - top });
    return { ...view, y: view.y + top };
  }

  /**
   * Watches the stage size from the first load of the original, since only a loaded original has a frame. Not
   * window `resize`: the stage also changes with the safe area border, which on iPhone may arrive after the
   * rotation. The observer belongs to the stage's window, since the viewer may be in an Obsidian popout
   * window.
   */
  #watchStage(): void {
    if (this.#resize) return;
    const stage = this.contentEl;
    const { ResizeObserver: Observer } = stage.win as Window & typeof globalThis;
    this.#resize = new Observer(() => this.#refit());
    this.#resize.observe(stage);
  }

  /**
   * The stage resized: phone rotation, safe area border, desktop window. Same size: nothing, since the first
   * notification comes right after subscribing and a running animation must not be cut. Otherwise the zoom
   * animation jumps to its target and the touch is forgotten, then the frame follows the new stage: a
   * zoomed-out view keeps its share of fit, a zoomed-in one keeps its level and the point under the stage
   * center (`refitView`); the first finger movement clamps the edges, as in Obsidian.
   */
  #refit(): void {
    const media = this.#media;
    const size = this.#size;
    if (!media || !size) return;
    const rect = this.contentEl.getBoundingClientRect();
    if (rect.width === this.#box.width && rect.height === this.#box.height) return;
    // Fingers of all three gestures go through the cancel path: on iPhone a rotation may take a touch without
    // a release. Except a finger of a running swipe down or edge gesture: its moves keep coming, it is on
    // screen, and the swipe itself may have moved the stage: in a window with a scrollbar (desktop, mobile
    // emulation) a stage moved down adds a scrollbar and the stage width changes mid-swipe (measured: 358 →
    // 346 → 358 px). If such a finger does stick, the next touch forgets it.
    const live = new Set([
      ...(this.#swipe.dragging ? this.#swipe.fingers : []),
      ...(this.#edge.active ? this.#edge.fingers : []),
    ]);
    this.#forgetLost((id) => !live.has(id));
    this.#zoomSettle();
    const from: Frame = { size, box: this.#box, fit: this.#fitView };
    this.#box = { width: rect.width, height: rect.height };
    this.#fitView = this.#fit(media, size, this.#box);
    this.#fitScale = this.#fitView.scale;
    this.#apply(refitView(this.#view, from, { size, box: this.#box, fit: this.#fitView }));
  }

  /**
   * Strip above video, px: the computed `--buba-viewer-video-top`; 0 if unset or the stage is shorter than
   * it.
   */
  #videoTop(height: number): number {
    const stage = this.contentEl;
    const top = Number.parseFloat(
      stage.win.getComputedStyle(stage).getPropertyValue('--buba-viewer-video-top'),
    );
    return Number.isFinite(top) && top > 0 && top < height ? top : 0;
  }

  #empty(path: string): void {
    const box = this.contentEl.createDiv({ cls: 'buba-viewer-empty' });
    const name = path.slice(path.lastIndexOf('/') + 1);
    const file = this.app.vault.getFileByPath(path);
    // File type icon, the same as on the tile and in the file panel (from formatFamily); for a file missing
    // from the vault, the generic `file` sheet, as in the panel.
    setIcon(
      box.createDiv({ cls: 'buba-viewer-empty-icon' }),
      file ? formatFamily(file.extension).icon : 'file',
    );
    box.createDiv({ text: name });
    box.createDiv({ cls: 'buba-viewer-empty-note', text: t('noPreview') });
    if (!file) return;
    // The viewer closes and the file opens in this same tab, as with a double-click on the tile (open.ts).
    if (opensInObsidian(file))
      new ButtonComponent(box)
        .setButtonText(t('open'))
        .setCta()
        .onClick(() => {
          this.close();
          void this.app.workspace.getLeaf(false).openFile(file);
        });
    // No own view: the same public `openFile` does not change the tab's view but hands the file to the
    // default app, or to the system "Share" sheet on iPhone. The label matches Obsidian's file menu item
    // (`Platform.isMobileApp`). The viewer stays open: nothing opened in Obsidian, and the arrows keep
    // paging.
    else if (opensInDefaultApp(file, name))
      new ButtonComponent(box)
        .setButtonText(Platform.isMobileApp ? t('share') : t('openInDefaultApp'))
        .setCta()
        .onClick(() => {
          void this.app.workspace.getLeaf(false).openFile(file);
        });
  }

  /** Releases the original: video stops, loading is aborted. */
  #release(): void {
    this.#fitButton.hide();
    const media = this.#media;
    this.#media = null;
    this.#size = null;
    this.#drag = null;
    this.#swipeStop();
    this.#zoomStop();
    if (!media) return;
    const video = media.instanceOf(HTMLVideoElement) ? media : null;
    video?.pause();
    media.removeAttribute('src');
    video?.load();
  }

  /**
   * Swipe down closes the viewer, like Obsidian's native image viewer (src/core/viewer/swipe.ts). Touch only:
   * mouse, wheel and middle button are handled above. The `.modal-content` stage moves, like Obsidian's image
   * wrapper, not the modal: on phones the modal's `close()` slides it down with the native animation.
   *
   * Listeners are on the modal, not the stage: on phones the stage sits inside the safe area and the border
   * around it (`viewer.css`) is the modal itself, so a touch at the very screen edge lands on the border.
   * `#touchedAt` decides where a touch started: the stage gets all three gestures, the border only the edge
   * gesture. Moves, releases and cancels go to all three, and each ignores fingers that are not its own.
   */
  #listenSwipe(): void {
    const modal = this.modalEl;
    modal.addEventListener('pointerdown', (evt) => {
      if (evt.pointerType !== 'touch') return;
      // Whether something was moving before the touch: the touch is about to stop zoom animation, momentum
      // and swipe spring back.
      const still = !this.#zoomFrame && !this.#glideFrame && !this.#swipeFrame;
      // A primary touch means no other fingers are on screen (Pointer Events 3, "the primary pointer"): any
      // finger the gestures still hold is stuck, its release never came.
      if (evt.isPrimary === true) this.#forgetLost();
      const where = this.#touchedAt(evt);
      // The buttons react to any touch on the modal: a second finger on a button or on the border still makes
      // a pinch.
      this.#tap.down(evt.pointerId, { x: evt.clientX, y: evt.clientY }, evt.timeStamp, {
        stage: where === 'stage' && this.#tapsMedia(evt),
        zoomed: this.#zoomed(),
        still,
      });
      if (where === null) return;
      if (where === 'frame') {
        // A border finger neither moves nor zooms the image: Obsidian's image viewer ignores touches on the
        // margin around the image. The edge goes first: only it puts back an unzoomed image returning after a
        // swipe.
        const edge = this.#atEdge(evt) && this.#swipeAllowed(evt) && !this.#zoomed();
        this.#edge.down(evt.pointerId, evt.clientX, evt.clientY, evt.timeStamp, edge);
        return;
      }
      // Pinch first: it settles an image still in motion, and the swipe decides by where it settled.
      this.#zoomDown(evt);
      const allowed = this.#swipeAllowed(evt);
      // The edge gesture only for an unzoomed image: on a zoomed one a finger at the edge pans it.
      const edge = allowed && !this.#zoomed() && this.#atEdge(evt);
      this.#edge.down(evt.pointerId, evt.clientX, evt.clientY, evt.timeStamp, edge);
      const end = this.#swipe.down(evt.pointerId, evt.clientX, evt.clientY, evt.timeStamp, allowed);
      if (end === 'back') this.#swipeBack();
    });
    modal.addEventListener('pointermove', (evt) => {
      if (evt.pointerType !== 'touch') return;
      this.#tap.move(evt.pointerId, { x: evt.clientX, y: evt.clientY });
      // A touch taken by the edge gesture does not go to swipe down: the viewer stays and the panel slides
      // out itself.
      if (this.#edge.move(evt.pointerId, evt.clientX, evt.clientY, evt.timeStamp)) {
        this.#zoomMove(evt);
        evt.preventDefault();
        return;
      }
      // Swipe before pan: on a zoomed image with its top at the edge the finger drives both pan (from 5 px)
      // and swipe (from 20 px down). Once the swipe starts the finger leaves pan through the cancel path,
      // without momentum: the image stops and the stage moves.
      const offset = this.#swipe.move(evt.pointerId, evt.clientX, evt.clientY, evt.timeStamp);
      if (offset === null) {
        this.#zoomMove(evt);
        return;
      }
      if (this.#zoomed()) this.#zoomCancel(evt.pointerId);
      else this.#zoomMove(evt);
      evt.preventDefault();
      this.#swipeShow(offset, dismissFade(offset, this.modalEl.offsetHeight));
    });
    modal.addEventListener('pointerup', (evt) => {
      if (evt.pointerType !== 'touch') return;
      if (this.#tap.up(evt.pointerId, { x: evt.clientX, y: evt.clientY }, evt.timeStamp) === 'wait')
        this.#tapWait();
      this.#zoomEnd(evt, 'up');
      // The threshold is half of Obsidian's drawer, whose width follows the screen width, not the stage.
      const drawer = drawerWidth(this.modalEl.win.innerWidth, Platform.isPhone);
      const panel = this.#edge.up(evt.pointerId, evt.clientX, drawer);
      const end = this.#swipe.up(evt.pointerId, evt.clientY, this.contentEl.clientHeight);
      if (panel) this.#toPanel();
      else if (end === 'close') this.#swipeAway();
      else if (end === 'back') this.#swipeBack();
    });
    modal.addEventListener('pointercancel', (evt) => {
      if (evt.pointerType !== 'touch') return;
      this.#tap.cancel(evt.pointerId);
      this.#zoomEnd(evt, 'cancel');
      this.#edge.cancel(evt.pointerId);
      if (this.#swipe.cancel(evt.pointerId) === 'back') this.#swipeBack();
    });
  }

  /**
   * Lost release: WebKit on iOS stops sending events for a touch taken by a system gesture, neither
   * `pointerup` nor `pointercancel` (also seen in Flutter web, flutter/flutter issue 188781; WebKit bug
   * 240917). The finger stays with the gestures and every new touch looks like a "second finger" to them:
   * swipe down, the edge gesture, pan and double-tap are dead and the viewer cannot be closed. Besides a new
   * primary touch (`#listenSwipe`) and a rotation (`#refit`), the viewer listens for: document
   * `touchend`/`touchcancel` in the capture phase with no fingers on screen, forget all; on iOS also those
   * whose `pointerId` is not among `Touch.identifier` (the ids match in WebKit, not in Chromium, as Flutter
   * notes); the document hidden or the window blurred, forget all. In a normal gesture no fingers are held by
   * then, since pointer events arrive before touch events.
   */
  #listenLost(): void {
    const doc = this.modalEl.doc;
    const win = this.modalEl.win;
    doc.addEventListener('touchend', this.#onTouchEnd, true);
    doc.addEventListener('touchcancel', this.#onTouchEnd, true);
    // Touches belong to the viewer's gestures: while a gesture holds a finger, touchmove and iOS gestures are
    // cancelled, non-passively, otherwise `preventDefault` has no effect (documents listen passively by
    // default).
    doc.addEventListener('touchmove', this.#onTouchMove, { capture: true, passive: false });
    doc.addEventListener('gesturestart', this.#onGesture, { capture: true, passive: false });
    doc.addEventListener('gesturechange', this.#onGesture, { capture: true, passive: false });
    doc.addEventListener('visibilitychange', this.#onVisibility);
    win.addEventListener('blur', this.#onBlur);
    this.#lostOn = { doc, win };
  }

  #unlistenLost(): void {
    const on = this.#lostOn;
    if (!on) return;
    this.#lostOn = null;
    on.doc.removeEventListener('touchend', this.#onTouchEnd, true);
    on.doc.removeEventListener('touchcancel', this.#onTouchEnd, true);
    on.doc.removeEventListener('touchmove', this.#onTouchMove, true);
    on.doc.removeEventListener('gesturestart', this.#onGesture, true);
    on.doc.removeEventListener('gesturechange', this.#onGesture, true);
    on.doc.removeEventListener('visibilitychange', this.#onVisibility);
    on.win.removeEventListener('blur', this.#onBlur);
  }

  /**
   * Whether a gesture holds the touch: a finger on pinch or image pan, or a running swipe down or edge
   * gesture. Then the touch belongs to the viewer, otherwise iOS hands it to its own recognizer and sends
   * `pointercancel` (MDN:
   * https://developer.mozilla.org/docs/Web/API/Pointer_events#touch-action_css_property). On a video without
   * a swipe the finger goes to the player, so its scrubber and buttons work as usual.
   */
  #holdsTouch(): boolean {
    return this.#touchZoom.fingers.length > 0 || this.#swipe.dragging || this.#edge.active;
  }

  readonly #onTouchMove = (evt: TouchEvent): void => {
    const held = this.#holdsTouch();
    if (held && evt.cancelable !== false) evt.preventDefault();
  };

  /**
   * iOS gesture (`GestureEvent`, Safari and WebKit only): page zoom is not wanted while a viewer gesture
   * holds a touch.
   */
  readonly #onGesture = (evt: Event): void => {
    if (this.#holdsTouch()) evt.preventDefault();
  };

  readonly #onTouchEnd = (evt: TouchEvent): void => {
    const { touches } = evt;
    if (touches.length === 0) this.#forgetLost();
    else if (Platform.isIosApp) {
      const onScreen = new Set<number>();
      for (let i = 0; i < touches.length; i++) {
        const one = touches[i];
        if (one) onScreen.add(one.identifier);
      }
      this.#forgetLost((id) => !onScreen.has(id));
    }
  };

  readonly #onVisibility = (): void => {
    if (this.#lostOn?.doc.visibilityState === 'hidden') this.#forgetLost();
  };

  readonly #onBlur = (): void => {
    this.#forgetLost();
  };

  /**
   * Forgets fingers that are no longer on screen (`gone`, all by default) through the same path as
   * `pointercancel`: a swiped stage springs back, a pinch ends, and the previous tap of a double-tap is kept,
   * unlike `reset()`.
   */
  #forgetLost(gone: (id: number) => boolean = () => true): void {
    for (const id of this.#tap.fingers.filter(gone)) this.#tap.cancel(id);
    const zoom = this.#touchZoom.fingers.filter(gone);
    const swipe = this.#swipe.fingers.filter(gone);
    const edge = this.#edge.fingers.filter(gone);
    for (const id of zoom) this.#zoomCancel(id);
    for (const id of edge) this.#edge.cancel(id);
    for (const id of swipe) if (this.#swipe.cancel(id) === 'back') this.#swipeBack();
  }

  /**
   * Whether a tap may hide the buttons: an image or video is loaded, the viewer is not leaving, and a tap on
   * video is not in the bottom strip with the player's scrubber (`inVideoBar`, as for the swipe), which
   * belongs to the player. "No preview" keeps the buttons.
   */
  #tapsMedia(evt: PointerEvent): boolean {
    const media = this.#media;
    if (!media || !this.#size || this.#leaving) return false;
    const onVideo = evt.target === media && media.instanceOf(HTMLVideoElement);
    return !(onVideo && inVideoBar(evt.clientY, media.getBoundingClientRect().bottom));
  }

  /**
   * Single tap: after the double-tap pause, toggle the buttons if no second tap came. Phones only: desktop
   * and tablet never hide the buttons. On video the viewer buttons toggle on the same tap as the player
   * controls but on their own: `<video controls>` has no "player hid its controls" event in WebKit or
   * Chromium.
   */
  #tapWait(): void {
    if (!Platform.isPhone) return;
    const win = this.modalEl.win;
    if (this.#tapTimer) win.clearTimeout(this.#tapTimer);
    this.#tapTimer = win.setTimeout(() => {
      this.#tapTimer = 0;
      if (this.#tap.due()) this.#controlsAnimate(!this.#controlsHidden);
    }, DOUBLE_TAP_MS);
  }

  /**
   * Hides or shows the viewer buttons: the `--buba-viewer-controls` share over `CONTROLS_FADE_MS` on
   * Obsidian's curve, per window frame like the swipe; hidden buttons are not clickable
   * (`is-controls-hidden`, viewer.css), and a tap there goes to the stage.
   */
  #controlsAnimate(hidden: boolean): void {
    this.#controlsHidden = hidden;
    this.modalEl.toggleClass('is-controls-hidden', hidden);
    const win = this.modalEl.win;
    if (this.#controlsFrame) win.cancelAnimationFrame(this.#controlsFrame);
    this.#controlsFrame = 0;
    const from = this.#controlsShown;
    const to = hidden ? 0 : 1;
    if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.#controlsShow(to);
      return;
    }
    let start: number | null = null;
    const step = (now: number): void => {
      start ??= now;
      const p = Math.min(1, (now - start) / CONTROLS_FADE_MS);
      this.#controlsShow(p < 1 ? from + (to - from) * ease(p) : to);
      this.#controlsFrame = p < 1 ? win.requestAnimationFrame(step) : 0;
    };
    this.#controlsFrame = win.requestAnimationFrame(step);
  }

  /** Visible share of the buttons; fully visible means no property of our own. */
  #controlsShow(shown: number): void {
    this.#controlsShown = shown;
    this.modalEl.setCssProps({ '--buba-viewer-controls': shown === 1 ? '' : String(shown) });
  }

  /** Another file or the viewer closed: no tap pending, buttons visible at once. */
  #controlsReset(): void {
    const win = this.modalEl.win;
    this.#tap.reset();
    if (this.#tapTimer) win.clearTimeout(this.#tapTimer);
    if (this.#controlsFrame) win.cancelAnimationFrame(this.#controlsFrame);
    this.#tapTimer = 0;
    this.#controlsFrame = 0;
    if (this.#controlsHidden) this.modalEl.removeClass('is-controls-hidden');
    this.#controlsHidden = false;
    if (this.#controlsShown !== 1) this.#controlsShow(1);
  }

  /**
   * Where a touch on the viewer started: `stage` is the stage and everything on it; `frame` is the safe area
   * border alongside the stage, right and left in landscape; `null` is the close button, the arrows and other
   * modal children outside the stage, and the border above and below the stage. The right arrow sits in the
   * edge zone (`EDGE_PX`), and a touch starting on it must not slide out the panel. The system owns the
   * status bar and home indicator, so no gesture starts there, just as Obsidian's drawer starts no gesture in
   * the bottom safe area (`window.innerHeight-e.startY<i`, app.js 1.14.4 and 1.13.7).
   */
  #touchedAt(evt: PointerEvent): 'stage' | 'frame' | null {
    const target = evt.target as Node | null;
    if (target && this.contentEl.contains(target)) return 'stage';
    if (target !== this.modalEl) return null;
    const box = this.contentEl.getBoundingClientRect();
    return evt.clientY >= box.top && evt.clientY <= box.bottom ? 'frame' : null;
  }

  /** The viewer's file in the vault; `null` if deleted or the path is empty. */
  #file(): TFile | null {
    return this.app.vault.getFileByPath(this.#paths[this.#index] ?? '');
  }

  /**
   * Whether the edge gesture may start from this touch: phone or tablet (the right panel is a drawer there),
   * the viewer's file exists in the vault, and the touch is within `EDGE_PX` of the stage's right edge or
   * beyond it, in the safe area border. On phones the stage sits inside the safe area (`viewer.css`), so the
   * zone is 40 px plus the inset from the screen edge, as for Obsidian 1.14.4's Settings "back" gesture (in
   * 1.13.7 it was 40 px from the screen edge without the inset). Otherwise as for swipe down
   * (`#swipeAllowed`): outside the video scrubber strip, not while the viewer is leaving, and only for an
   * unzoomed image (`#zoomed`). On Android the zone is wider by the system "Back" gesture strip
   * (`ANDROID_BACK_PX`): the system takes touches at the very edge.
   */
  #atEdge(evt: PointerEvent): boolean {
    if (!Platform.isMobile || !this.#file()) return false;
    const system = Platform.isAndroidApp ? ANDROID_BACK_PX : 0;
    return atRightEdge(evt.clientX, this.contentEl.getBoundingClientRect().right, system);
  }

  /**
   * The edge gesture was released open: the viewer leaves with the same `close()` as swipe down and returns
   * to the grid the same way (`open.ts`); then a workspace event with the viewer's file makes the "File
   * panel" slide itself out. A new touch starts no gesture: on phones the modal closes with an animation
   * while the stage listeners are still alive.
   */
  #toPanel(): void {
    const file = this.#file();
    if (!file) return;
    this.#leaving = true;
    this.close();
    this.app.workspace.trigger(FILE_PANEL, file);
  }

  /**
   * Whether a swipe may start from this touch: the viewer is not leaving, the touch is not in the bottom
   * video strip with the player's scrubber (above the strip a swipe works on video: player buttons react to
   * taps, and sideways scrubbing never becomes a swipe, see `goesSideways`), and the image is not zoomed or
   * its top is at the stage top, so the finger can no longer pan it down (`atTopEdge`, like iPhone Photos and
   * unlike Obsidian, where the swipe only closes an unzoomed image). The rule applies at touch start: a pan
   * that reaches the top mid-touch does not turn into a swipe, the next touch closes. If a previous swipe is
   * still springing back, the image snaps into place.
   */
  #swipeAllowed(evt: PointerEvent): boolean {
    if (this.#leaving) return false;
    const media = this.#media;
    const onVideo = media && evt.target === media && media.instanceOf(HTMLVideoElement);
    if (onVideo && inVideoBar(evt.clientY, media.getBoundingClientRect().bottom)) return false;
    if (this.#zoomed() && !atTopEdge(this.#view)) return false;
    if (this.#swipeFrame) {
      this.#swipeCancelFrame();
      this.#swipeShow(0, 1);
    }
    return true;
  }

  /**
   * Whether the image is larger than fitted. With a tolerance: wheeling in and back out by the same number of
   * steps returns the fit scale with a rounding error (440.00000000000006 instead of 440), and a strict
   * comparison would count that as zoomed.
   */
  #zoomed(): boolean {
    return this.#size !== null && this.#view.scale > this.#fitScale * (1 + 1e-9);
  }

  /**
   * Swipe frame: the stage is `offset` lower, modal background and close button at share `fade`; at rest, no
   * styles.
   */
  #swipeShow(offset: number, fade: number): void {
    this.#swipeOffset = offset;
    this.#swipeFade = fade;
    const rest = offset === 0 && fade === 1;
    this.contentEl.setCssStyles({ transform: rest ? '' : `translateY(${offset}px)` });
    this.modalEl.setCssProps({
      '--buba-viewer-backdrop': rest ? '' : `${fade * 100}%`,
      '--buba-viewer-fade': rest ? '' : String(fade),
    });
  }

  /** Not pulled far enough: back into place over `BACK_MS`. */
  #swipeBack(): void {
    this.#swipeAnimate(0, 1, BACK_MS);
  }

  /**
   * Pulled far enough: down past the modal edge with background and close button fading, then the modal
   * closes.
   */
  #swipeAway(): void {
    this.#leaving = true;
    const height = this.modalEl.offsetHeight;
    this.#swipeAnimate(flyTo(height), 0, flyMs(this.#swipeOffset, height), () => this.close());
  }

  /** Animates from the current swipe frame to `offset` and `fade` on Obsidian's curve, per window frame. */
  #swipeAnimate(offset: number, fade: number, ms: number, done?: () => void): void {
    this.#swipeCancelFrame();
    const win = this.modalEl.win;
    const from = { offset: this.#swipeOffset, fade: this.#swipeFade };
    let start: number | null = null;
    const step = (now: number): void => {
      start ??= now;
      const p = ms > 0 ? Math.min(1, (now - start) / ms) : 1;
      if (p < 1) {
        const k = ease(p);
        this.#swipeShow(from.offset + (offset - from.offset) * k, from.fade + (fade - from.fade) * k);
        this.#swipeFrame = win.requestAnimationFrame(step);
        return;
      }
      this.#swipeFrame = 0;
      this.#swipeShow(offset, fade);
      done?.();
    };
    this.#swipeFrame = win.requestAnimationFrame(step);
  }

  #swipeCancelFrame(): void {
    if (this.#swipeFrame) this.modalEl.win.cancelAnimationFrame(this.#swipeFrame);
    this.#swipeFrame = 0;
  }

  /** The viewer changed content or closed: the touch is forgotten and the stage is back in place. */
  #swipeStop(): void {
    this.#swipeCancelFrame();
    this.#swipe.reset();
    this.#edge.reset();
    this.#leaving = false;
    if (this.#swipeOffset !== 0 || this.#swipeFade !== 1) this.#swipeShow(0, 1);
  }

  /**
   * Frame for pinch and finger pan: only a loaded image not leaving by swipe. Video and "No preview" are
   * untouched.
   */
  #zoomFrameOf(): Frame | null {
    const media = this.#media;
    const size = this.#size;
    if (!media || !size || this.#leaving || media.instanceOf(HTMLVideoElement)) return null;
    return { size, box: this.#box, fit: this.#fitView };
  }

  /** Touch point in the stage, as for the wheel (`#zoom`). */
  #stagePoint(evt: PointerEvent): Point {
    const box = this.contentEl.getBoundingClientRect();
    return { x: evt.clientX - box.left, y: evt.clientY - box.top };
  }

  /**
   * A finger touched down: the zoom animation jumps to its end and momentum stops, as in Obsidian
   * (`stopMomentum`).
   */
  #zoomDown(evt: PointerEvent): void {
    this.#zoomSettle();
    const frame = this.#zoomFrameOf();
    if (frame) this.#touchZoom.down(evt.pointerId, this.#stagePoint(evt), evt.timeStamp, this.#view, frame);
  }

  /**
   * A finger moved: the new view applies at once. If a finger left after a pinch pans the image while it
   * springs back to the limit, the spring back is cut: finger pan clamps the edges anyway.
   */
  #zoomMove(evt: PointerEvent): void {
    const frame = this.#zoomFrameOf();
    if (!frame) return;
    const view = this.#touchZoom.move(evt.pointerId, this.#stagePoint(evt), evt.timeStamp, this.#view, frame);
    if (this.#touchZoom.busy) evt.preventDefault();
    if (!view) return;
    this.#zoomCancelFrames();
    this.#apply(view);
  }

  /**
   * A finger lifted or the touch was cancelled: spring back or double-tap animate, a released pan glides with
   * momentum. Without an image under pinch (leaving, video) the finger is still removed, with no animation or
   * momentum.
   */
  #zoomEnd(evt: PointerEvent, how: 'up' | 'cancel'): ZoomEnd {
    const frame = this.#zoomFrameOf();
    if (how === 'cancel' || !frame) {
      this.#zoomCancel(evt.pointerId);
      return null;
    }
    const end = this.#touchZoom.up(evt.pointerId, this.#stagePoint(evt), evt.timeStamp, this.#view, frame);
    this.#zoomFinish(end, frame);
    return end;
  }

  /** Finger `id` was cancelled or forgotten: the pinch ends, with no momentum and no tap. */
  #zoomCancel(id: number): void {
    const frame = this.#zoomFrameOf();
    const end = this.#touchZoom.cancel(id, this.#view, frame);
    if (frame) this.#zoomFinish(end, frame);
  }

  #zoomFinish(end: ZoomEnd, frame: Frame): void {
    if (end && 'animate' in end) this.#zoomAnimate(end.animate);
    else if (end) this.#glide(end.momentum, frame);
  }

  /**
   * From the current view to `target` over `ZOOM_MS` on Obsidian's curve, per window frame; scale and offset
   * share one progress.
   */
  #zoomAnimate(target: ViewState): void {
    this.#zoomSettle();
    const win = this.modalEl.win;
    if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.#apply(target);
      return;
    }
    const from = this.#view;
    this.#zoomTo = target;
    let start: number | null = null;
    const step = (now: number): void => {
      start ??= now;
      const p = Math.min(1, (now - start) / ZOOM_MS);
      if (p < 1) {
        const k = ease(p);
        this.#apply({
          scale: from.scale + (target.scale - from.scale) * k,
          x: from.x + (target.x - from.x) * k,
          y: from.y + (target.y - from.y) * k,
        });
        this.#zoomFrame = win.requestAnimationFrame(step);
        return;
      }
      this.#zoomFrame = 0;
      this.#zoomTo = null;
      this.#apply(target);
    };
    this.#zoomFrame = win.requestAnimationFrame(step);
  }

  /**
   * Momentum of a released pan at `velocity`, px/ms: each frame pans and clamps the edges, as in Obsidian.
   */
  #glide(velocity: Point, frame: Frame): void {
    const win = this.modalEl.win;
    let speed = velocity;
    let last: number | null = null;
    const step = (now: number): void => {
      const dt = last === null ? MOMENTUM_FIRST_MS : now - last;
      last = now;
      const next = momentumStep(speed, dt);
      speed = next.velocity;
      this.#apply(clampView(panBy(this.#view, next.dx, next.dy), frame));
      this.#glideFrame = next.done ? 0 : win.requestAnimationFrame(step);
    };
    this.#glideFrame = win.requestAnimationFrame(step);
  }

  /** The zoom animation jumps to its target and momentum stops. */
  #zoomSettle(): void {
    const target = this.#zoomTo;
    this.#zoomCancelFrames();
    if (target) this.#apply(target);
  }

  #zoomCancelFrames(): void {
    if (this.#zoomFrame) this.modalEl.win.cancelAnimationFrame(this.#zoomFrame);
    if (this.#glideFrame) this.modalEl.win.cancelAnimationFrame(this.#glideFrame);
    this.#zoomFrame = 0;
    this.#glideFrame = 0;
    this.#zoomTo = null;
  }

  /** The viewer changed content or closed: touches are forgotten, no frames run. */
  #zoomStop(): void {
    this.#zoomCancelFrames();
    this.#touchZoom.reset();
  }
}
