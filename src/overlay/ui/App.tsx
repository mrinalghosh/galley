import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MAX_SELECTED_ELEMENTS } from '../../shared/constants.js';
import type { CapturedError, Comment, ElementInfo, NewComment, Rect, ServerEvent, TargetInfo } from '../../shared/protocol.js';
import { api } from '../api.js';
import { type Mode, onShellMessage, postToShell } from '../bridge.js';
import { boundingRect, captureElement, commonAncestor, pageRect, resolveElement, selectorFor } from '../capture.js';
import type { ErrorRing } from '../errors.js';
import { connectEvents } from '../events.js';
import { currentUrl, pageToViewport, viewportRect } from '../geometry.js';
import { type Point, polygonBounds } from '../lasso.js';
import { elementsInLasso } from '../lasso-dom.js';
import { watchLayout } from '../layout.js';
import { isTyping, Picker } from '../picker.js';
import { captureSelection } from '../screenshot.js';
import { type BatchItem, BatchPins, BatchTray, newBatchId } from './Batch.js';
import { COMPOSER_WIDTH, Composer, type ComposerChoice } from './Composer.js';
import { ErrorList } from './ErrorList.js';
import { describe, Highlight } from './Highlight.js';
import { LassoGesture, LassoLayer } from './Lasso.js';
import { Panel } from './Panel.js';
import { Pins } from './Pins.js';
import { Toolbar } from './Toolbar.js';

export type Tool = 'pick' | 'lasso' | 'none';

interface Selected {
  el: Element;
  /** Captured at pick time, in case a hot reload replaces the node before Send. */
  info: ElementInfo;
}

/** A lasso selection: the loop as drawn and what it records on the comment. */
interface LassoSelection {
  points: Point[];
  /** Page coordinates, rounded. */
  region: Rect;
  ancestor?: Element;
}

/** PNG data URL, or undefined when capture failed. Never rejects. */
type Shot = Promise<string | undefined>;

const QUEUE = 'queue';
const TARGET_KEY = 'galley.target';
/** Let a burst of Shift-clicks settle before rendering a screenshot. */
const SHOT_DELAY_MS = 150;
/** Send never waits longer than this for the screenshot; it goes without one. */
const SHOT_WAIT_MS = 8000;

export function App({ host, mode, errors }: { host: HTMLElement; mode: Mode; errors: ErrorRing }) {
  const [tool, setTool] = useState<Tool>('none');
  const [hovered, setHovered] = useState<Element>();
  const [selection, setSelection] = useState<Selected[]>([]);
  const [lasso, setLasso] = useState<LassoSelection>();
  const [draft, setDraft] = useState<Point[]>();
  const [comments, setComments] = useState<Comment[]>([]);
  const [targets, setTargets] = useState<TargetInfo[]>([]);
  const [target, setTarget] = useState<string>(loadTarget);
  const [panelOpen, setPanelOpen] = useState(false);
  const [openPin, setOpenPin] = useState<string>();
  const [hoverPin, setHoverPin] = useState<string>();
  const [connected, setConnected] = useState(false);
  const [recentErrors, setRecentErrors] = useState<CapturedError[]>(() => errors.list());
  const [errorsOpen, setErrorsOpen] = useState(false);
  /** The error being turned into a comment with "Edit"; the composer opens without a selection. */
  const [errorDraft, setErrorDraft] = useState<CapturedError>();
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [batchNotice, setBatchNotice] = useState<string>();
  const [, setTick] = useState(0);

  const picker = useMemo(
    () =>
      new Picker(host, {
        onHover: setHovered,
        onPick: (el, additive) => setSelection((prev) => pick(prev, el, additive)),
      }),
    [host],
  );

  const gesture = useMemo(
    () =>
      new LassoGesture({
        onDraft: setDraft,
        onCommit: (points) => {
          setDraft(undefined);
          const { selection, lasso } = lassoSelect(points);
          setSelection(selection);
          setLasso(lasso);
        },
      }),
    [],
  );

  const clearSelection = () => {
    setSelection([]);
    setLasso(undefined);
  };

  // Latest state for the long-lived window listeners below.
  const live = useRef({ tool, selection, lasso, panelOpen, errorsOpen, errorDraft });
  live.current = { tool, selection, lasso, panelOpen, errorsOpen, errorDraft };

  const changeTool = (next: Tool, fromShell = false) => {
    gesture.cancel();
    if (next !== tool || next === 'none') clearSelection();
    if (next !== 'none') setErrorDraft(undefined);
    setTool(next);
    if (mode === 'shell' && !fromShell) postToShell({ source: 'galley-overlay', type: 'tool-changed', tool: next });
  };
  const changeToolRef = useRef(changeTool);
  changeToolRef.current = changeTool;

  useEffect(() => {
    if (tool === 'pick') picker.start();
    else picker.stop();
  }, [tool, picker]);
  useEffect(() => () => picker.dispose(), [picker]);

  // Re-anchor pins and boxes whenever the page may have moved. Also re-attach
  // our host if the site's framework wiped it out.
  useEffect(
    () =>
      watchLayout(() => {
        if (!host.isConnected) document.documentElement.appendChild(host);
        setTick((t) => t + 1);
      }),
    [host],
  );

  useEffect(() => {
    const upsert = (comment: Comment) =>
      setComments((prev) => {
        const index = prev.findIndex((c) => c.id === comment.id);
        if (index === -1) return [...prev, comment].sort(byId);
        const next = prev.slice();
        next[index] = comment;
        return next;
      });
    const onEvent = (event: ServerEvent) => {
      if (event.type === 'comment') upsert(event.comment);
      else if (event.type === 'comment-deleted') setComments((prev) => prev.filter((c) => c.id !== event.id));
      else if (event.type === 'targets') setTargets(event.targets);
    };
    const resync = () => {
      setConnected(true);
      api.comments().then((list) => setComments(list.slice().sort(byId)), () => {});
      api.targets().then(setTargets, () => {});
    };
    const stream = connectEvents({ onEvent, onOpen: resync, onClose: () => setConnected(false) });
    return () => stream.close();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event)) return;
      const { tool, selection, lasso, panelOpen } = live.current;
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
      let handled = true;
      if (event.key === 'Escape') {
        if (gesture.cancel()) return swallowKey(event);
        const { errorsOpen, errorDraft } = live.current;
        if (selection.length || lasso) {
          setSelection([]);
          setLasso(undefined);
        } else if (errorDraft) setErrorDraft(undefined);
        else if (tool !== 'none') changeToolRef.current('none');
        else if (errorsOpen) setErrorsOpen(false);
        else if (panelOpen) setPanelOpen(false);
        else handled = false;
      } else if (event.altKey && tool === 'pick' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        picker.walk(event.key === 'ArrowUp' ? 'up' : 'down');
      } else if (plain && event.key.toLowerCase() === 'c') {
        changeToolRef.current(tool === 'pick' ? 'none' : 'pick');
      } else if (plain && event.key.toLowerCase() === 'l') {
        changeToolRef.current(tool === 'lasso' ? 'none' : 'lasso');
      } else handled = false;
      if (handled) swallowKey(event);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [picker, gesture]);

  // Render the screenshot as soon as a selection settles, so it shows the page
  // the user pointed at (before any reload) and Send doesn't wait for it.
  const shot = useRef<Shot>();
  useEffect(() => {
    shot.current = undefined;
    if (!selection.length && !lasso) return;
    const timer = setTimeout(() => {
      shot.current = startShot(selectionRegion(selection, lasso), lasso?.ancestor ?? selection[0]?.el);
    }, SHOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [selection, lasso]);

  useEffect(() => {
    if (mode !== 'shell') return;
    postToShell({ source: 'galley-overlay', type: 'ready', url: location.href });
    return onShellMessage((message) => {
      if (message.type === 'set-tool') changeToolRef.current(message.tool, true);
      else if (message.type === 'set-target') setTarget(message.target);
      else if (message.type === 'toggle-comments') togglePanelRef.current();
      else if (message.type === 'toggle-errors') toggleErrorsRef.current();
    });
  }, [mode]);

  useEffect(() => errors.subscribe(setRecentErrors), [errors]);
  // Declared after the effect that posts `ready`, which resets the shell's badge.
  useEffect(() => {
    if (mode === 'shell') postToShell({ source: 'galley-overlay', type: 'error-count', count: recentErrors.length });
  }, [mode, recentErrors.length]);

  // The comments list and the errors list share a corner; one at a time.
  const togglePanel = () => {
    setErrorsOpen(false);
    setPanelOpen((open) => !open);
  };
  const toggleErrors = () => {
    setPanelOpen(false);
    setErrorsOpen((open) => !open);
  };
  const togglePanelRef = useRef(togglePanel);
  togglePanelRef.current = togglePanel;
  const toggleErrorsRef = useRef(toggleErrors);
  toggleErrorsRef.current = toggleErrors;

  const targetNames = targets.length ? [...targets.map((t) => t.name), QUEUE] : [QUEUE];
  const chosenTarget = targetNames.includes(target) ? target : targetNames[0]!;
  const chooseTarget = (name: string) => {
    setTarget(name);
    saveTarget(name);
    // In the shell, the shell remembers the choice and offers to flush the queue.
    if (mode === 'shell') postToShell({ source: 'galley-overlay', type: 'target-changed', target: name });
    else offerFlush(name, comments);
  };

  const numbers = useMemo(() => new Map(comments.map((c, i) => [c.id, i + 1])), [comments]);
  const url = currentUrl();
  // Comments without elements (fix requests) have nothing to sit on: they're in the list only.
  const pagePins = comments.filter((c) => c.url === url && c.elements.length > 0);
  const liveSelection = selection.filter((s) => s.el.isConnected);

  const addComment = (created: Comment) =>
    setComments((prev) => (prev.some((c) => c.id === created.id) ? prev : [...prev, created].sort(byId)));

  /** The comment the open composer describes: the selection, or the error being edited. */
  const buildComment = async (text: string, { attachErrors }: ComposerChoice): Promise<NewComment> => {
    if (errorDraft) return errorComment(text, [errorDraft], chosenTarget);
    const elements = selection.map((s) => (s.el.isConnected ? captureElement(s.el) : s.info));
    const comment: NewComment = {
      text,
      url,
      viewport: currentViewport(),
      mode: lasso ? 'lasso' : 'pick',
      region: lasso ? lasso.region : boundingRect(elements.map((e) => e.rect)),
      elements,
      target: chosenTarget,
    };
    const ancestor = lasso ? lasso.ancestor : selection.length > 1 ? commonAncestor(liveSelection.map((s) => s.el)) : undefined;
    if (ancestor?.isConnected) comment.commonAncestor = selectorFor(ancestor);
    if (attachErrors && recentErrors.length) comment.errors = recentErrors;
    const pending = shot.current ?? startShot(selectionRegion(selection, lasso), lasso?.ancestor ?? selection[0]?.el);
    const screenshot = await withTimeout(pending, SHOT_WAIT_MS);
    if (screenshot) comment.screenshotDataUrl = screenshot;
    return comment;
  };

  const send = async (text: string, choice: ComposerChoice) => {
    addComment(await api.create(await buildComment(text, choice)));
    setErrorDraft(undefined);
    changeTool('none');
  };

  // Batched comments stay in this tab until "Send batch"; the pick tool stays on for the next one.
  const addToBatch = async (text: string, choice: ComposerChoice) => {
    const comment = await buildComment(text, choice);
    setBatch((prev) => [...prev, { key: `${Date.now()}-${prev.length}`, comment }]);
    setBatchNotice(undefined);
    setErrorDraft(undefined);
    clearSelection();
  };

  /**
   * Stores every batched comment as queued under one batch id, then flushes
   * exactly those to the target, which delivers them as ONE prompt.
   */
  const sendBatch = async () => {
    const items = batch;
    const target = chosenTarget;
    const batchId = newBatchId();
    const created: Comment[] = [];
    try {
      for (const item of items) created.push(await api.create({ ...item.comment, batch: batchId, target: QUEUE }));
    } finally {
      // Whatever reached the server is in the queue now, not the tray.
      const stored = new Set(items.slice(0, created.length).map((item) => item.key));
      setBatch((prev) => prev.filter((item) => !stored.has(item.key)));
      created.forEach(addComment);
    }
    if (target === QUEUE) {
      setBatchNotice(`Batch of ${created.length} queued. Pick a chat to send it as one prompt.`);
      return;
    }
    try {
      await api.flush(target, created.map((c) => c.id));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setBatchNotice(`Not sent (${reason}). The batch is queued; send it from the comments list.`);
    }
  };

  const sendFix = async (error: CapturedError) => {
    addComment(await api.create(errorComment(`Fix this error: ${error.message}`, [error], chosenTarget)));
  };

  const editError = (error: CapturedError) => {
    changeTool('none');
    setErrorsOpen(false);
    setErrorDraft(error);
  };

  const resend = async (comment: Comment) => {
    // Prefer the target picked now, if it's connected; otherwise retry the original one.
    const to = targets.some((t) => t.name === chosenTarget) ? chosenTarget : comment.target;
    await api.send(comment.id, to);
  };

  const remove = async (comment: Comment) => {
    await api.remove(comment.id);
    setComments((prev) => prev.filter((c) => c.id !== comment.id));
  };

  const reveal = (comment: Comment) => {
    const first = comment.elements[0];
    const el = first && resolveElement(first);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else if (first) window.scrollTo({ top: first.rect.y - 100, behavior: 'smooth' });
    setOpenPin(comment.id);
  };

  const hoverRect = hovered?.isConnected ? viewportRect(hovered) : undefined;
  const selectionRects = liveSelection.map((s) => viewportRect(s.el));
  const selectionAnchor = lasso ? pageToViewport(lasso.region) : selectionRects.length ? boundingRect(selectionRects) : undefined;
  const composerAnchor = selectionAnchor ?? (errorDraft ? centeredAnchor() : undefined);
  const picked = selection.map((s) => describe(s.el, s.info.rect) + (s.info.src ? ` · ${s.info.src}` : '')).join(', ');
  /** The error whose fix request is in the composer (a new selection takes over from it). */
  const editingError = selectionAnchor ? undefined : errorDraft;
  const summary = editingError
    ? `Console error, attached with its stack · ${editingError.message}`
    : lasso
      ? `Lasso · ${selection.length} element${selection.length === 1 ? '' : 's'}${picked ? `: ${picked}` : ''}`
      : picked;

  return (
    <div class="layer">
      <Pins comments={pagePins} numbers={numbers} openId={openPin} hoverId={hoverPin} onOpen={setOpenPin} onHover={setHoverPin} />
      <BatchPins items={batch} url={url} />
      <LassoLayer active={tool === 'lasso'} gesture={gesture} points={draft ?? lasso?.points} />
      {selectionRects.map((rect, i) => (
        <Highlight key={i} rect={rect} kind="selected" />
      ))}
      {tool === 'pick' && hovered && hoverRect && <Highlight rect={hoverRect} kind="hover" label={describe(hovered, hoverRect)} />}
      {composerAnchor && (
        <Composer
          key={editingError ? `error:${editingError.at}` : 'selection'}
          anchor={composerAnchor}
          summary={summary}
          initialText={editingError ? `Fix this error: ${editingError.message}` : undefined}
          attachLabel={!editingError && recentErrors.length ? `Attach recent errors (${recentErrors.length})` : undefined}
          targets={targetNames}
          target={chosenTarget}
          onTarget={chooseTarget}
          onSend={send}
          onBatch={addToBatch}
          onCancel={() => {
            clearSelection();
            setErrorDraft(undefined);
          }}
        />
      )}
      {(batch.length > 0 || batchNotice) && (
        <BatchTray
          items={batch}
          target={chosenTarget}
          notice={batchNotice}
          onRemove={(key) => setBatch((prev) => prev.filter((item) => item.key !== key))}
          onClear={() => {
            setBatch([]);
            setBatchNotice(undefined);
          }}
          onSend={sendBatch}
        />
      )}
      {errorsOpen && (
        <ErrorList
          errors={recentErrors}
          target={chosenTarget}
          onSendFix={sendFix}
          onEdit={editError}
          onClear={() => errors.clear()}
          onClose={() => setErrorsOpen(false)}
        />
      )}
      {panelOpen && (
        <Panel
          comments={comments}
          numbers={numbers}
          currentUrl={url}
          connected={connected}
          onClose={() => setPanelOpen(false)}
          onReveal={reveal}
          onSend={resend}
          onDelete={remove}
        />
      )}
      {mode === 'direct' && (
        <Toolbar
          tool={tool}
          commentCount={comments.length}
          panelOpen={panelOpen}
          errorCount={recentErrors.length}
          errorsOpen={errorsOpen}
          onTool={(next) => changeTool(next)}
          onTogglePanel={togglePanel}
          onToggleErrors={toggleErrors}
        />
      )}
    </div>
  );
}

function currentViewport(): NewComment['viewport'] {
  return { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio };
}

/** A comment about console errors, not elements: its region is the visible part of the page. */
function errorComment(text: string, errors: CapturedError[], target: string): NewComment {
  const region = { x: Math.round(window.scrollX), y: Math.round(window.scrollY), w: window.innerWidth, h: window.innerHeight };
  return { text, url: currentUrl(), viewport: currentViewport(), mode: 'pick', region, elements: [], errors, target };
}

/** Anchors the composer near the top centre when there's no selection to sit beside. */
function centeredAnchor(): Rect {
  const gap = 12;
  return { x: (window.innerWidth - COMPOSER_WIDTH) / 2 - gap, y: Math.round(window.innerHeight * 0.2), w: 0, h: 0 };
}

/** Turns a finished loop (page coordinates) into the selection it means. */
function lassoSelect(points: Point[]): { selection: Selected[]; lasso: LassoSelection } {
  const inView = points.map((p) => ({ x: p.x - window.scrollX, y: p.y - window.scrollY }));
  const elements = elementsInLasso(inView);
  const b = polygonBounds(points);
  const region = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
  return {
    selection: elements.map((el) => ({ el, info: captureElement(el) })),
    lasso: { points, region, ancestor: commonAncestor(elements) },
  };
}

/** What the screenshot covers: the lasso's box, or the union of the picked elements. */
function selectionRegion(selection: Selected[], lasso: LassoSelection | undefined): Rect {
  if (lasso) return lasso.region;
  return boundingRect(selection.map((s) => (s.el.isConnected ? pageRect(s.el) : s.info.rect)));
}

/** A screenshot that never rejects: a failure is logged and the comment goes without one. */
function startShot(region: Rect, near: Element | undefined): Shot {
  return captureSelection(region, near?.isConnected ? near : undefined).catch((error: unknown) => {
    console.warn('[galley] screenshot failed; sending the comment without one.', error);
    return undefined;
  });
}

function withTimeout<T>(promise: Promise<T | undefined>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[galley] screenshot took longer than ${ms} ms; sending the comment without one.`);
      resolve(undefined);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function swallowKey(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/** Plain click replaces the selection; Shift-click toggles an element in or out. */
function pick(prev: Selected[], el: Element, additive: boolean): Selected[] {
  const entry = { el, info: captureElement(el) };
  if (!additive) return [entry];
  if (prev.some((s) => s.el === el)) return prev.filter((s) => s.el !== el);
  // Keep the selection flat: an element and its ancestor together say the same thing twice.
  const kept = prev.filter((s) => !el.contains(s.el) && !s.el.contains(el));
  return [...kept, entry].slice(-MAX_SELECTED_ELEMENTS);
}

/** Direct mode: picking a destination while comments are queued offers to send them there. */
function offerFlush(target: string, comments: Comment[]): void {
  const queued = comments.filter((c) => c.status === 'queued').length;
  if (target === QUEUE || queued === 0) return;
  if (!window.confirm(`Send ${queued} queued comment${queued === 1 ? '' : 's'} to ${target}?`)) return;
  api.flush(target).catch(() => {});
}

function byId(a: Comment, b: Comment): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// The site's origin storage; namespaced and best-effort (may be blocked).
function loadTarget(): string {
  try {
    return localStorage.getItem(TARGET_KEY) ?? QUEUE;
  } catch {
    return QUEUE;
  }
}

function saveTarget(name: string): void {
  try {
    localStorage.setItem(TARGET_KEY, name);
  } catch {
    // Not remembered; fine.
  }
}
