import { useEffect, useRef, useState } from 'preact/hooks';
import { onOverlayMessage, postToOverlay, type Tool } from './bridge.js';
import { Drawer } from './Drawer.js';
import { FlushOffer } from './FlushOffer.js';
import { CloseIcon } from './icons.js';
import { readConfig, rememberSitePath, sitePathFromHash, useStoredState } from './state.js';
import { effectiveTarget, flushQueued, QUEUE, targetOptions, useDestinations, useRememberedTarget } from './targets.js';
import { Toolbar } from './Toolbar.js';
import { viewportWidth, type ViewportId } from './viewports.js';

const config = readConfig();

export function App() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [initialPath] = useState(() => sitePathFromHash(location.hash));
  const [path, setPath] = useState(initialPath);
  const [tool, setTool] = useState<Tool>('none');
  const destinations = useDestinations();
  const [rememberedTarget, setRememberedTarget] = useRememberedTarget(config.target);
  const target = effectiveTarget(rememberedTarget, destinations.targets);
  // The destination to offer the queued comments to, until sent or dismissed.
  const [flushOffer, setFlushOffer] = useState<string>();
  const [errorCount, setErrorCount] = useState(0);
  const [serviceWorker, setServiceWorker] = useState(false);
  const [swDismissed, setSwDismissed] = useState(false);
  const [viewport, setViewport] = useStoredState<ViewportId>('galley.viewport', 'full');
  const [drawerOpen, setDrawerOpen] = useStoredState('galley.drawer.open', false);
  const [drawerWidth, setDrawerWidth] = useStoredState('galley.drawer.width', 440);
  const [dragging, setDragging] = useState(false);

  // Latest values for the message handler, which is registered once.
  const latest = useRef({ tool, target, chooseTarget: (_: string) => {} });

  const chooseTool = (next: Tool) => {
    setTool(next);
    postToOverlay(frame.current, { source: 'galley-shell', type: 'set-tool', tool: next });
  };
  const chooseTarget = (next: string) => {
    setRememberedTarget(next);
    setFlushOffer(next === QUEUE ? undefined : next);
  };
  latest.current = { tool, target, chooseTarget };
  const toggleComments = () => postToOverlay(frame.current, { source: 'galley-shell', type: 'toggle-comments' });
  const toggleErrors = () => postToOverlay(frame.current, { source: 'galley-shell', type: 'toggle-errors' });
  const reload = () => frame.current?.contentWindow?.location.reload();

  useEffect(
    () =>
      onOverlayMessage(
        () => frame.current,
        (message) => {
          if (message.type === 'ready') {
            // A fresh page: restore the shell's choices in its overlay.
            const { tool: currentTool, target: currentTarget } = latest.current;
            postToOverlay(frame.current, { source: 'galley-shell', type: 'set-target', target: currentTarget });
            postToOverlay(frame.current, { source: 'galley-shell', type: 'set-tool', tool: currentTool });
            setErrorCount(0);
          } else if (message.type === 'tool-changed') {
            setTool(message.tool);
          } else if (message.type === 'error-count') {
            setErrorCount(message.count);
          } else if (message.type === 'target-changed') {
            latest.current.chooseTarget(message.target);
          }
        },
      ),
    [],
  );

  // Keep the overlay's composer on the same target, including when a listener comes or goes.
  useEffect(() => {
    postToOverlay(frame.current, { source: 'galley-shell', type: 'set-target', target });
    setFlushOffer(target === QUEUE ? undefined : target);
  }, [target]);

  useShortcuts(tool, chooseTool);
  useEffect(() => setServiceWorker((current) => current || Boolean(navigator.serviceWorker?.controller)), []);

  const onFrameLoad = () => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    try {
      if (win.navigator.serviceWorker?.controller) setServiceWorker(true);
      win.navigator.serviceWorker?.addEventListener('controllerchange', () => setServiceWorker(true));
      const current = win.location.pathname + win.location.search + win.location.hash;
      setPath(current);
      rememberSitePath(current);
    } catch {
      // The frame navigated off-origin; nothing to inspect.
    }
  };

  const width = viewportWidth(viewport);
  return (
    <div class="g-shell">
      <Toolbar
        tool={tool}
        onTool={chooseTool}
        onToggleComments={toggleComments}
        errorCount={errorCount}
        onToggleErrors={toggleErrors}
        target={target}
        targets={targetOptions(destinations.targets)}
        onTarget={chooseTarget}
        viewport={viewport}
        onViewport={setViewport}
        onReload={reload}
        path={path}
      />
      {flushOffer === target && destinations.queued.length > 0 && (
        <FlushOffer
          target={target}
          count={destinations.queued.length}
          onSend={async () => {
            await flushQueued(target);
            setFlushOffer(undefined);
          }}
          onDismiss={() => setFlushOffer(undefined)}
        />
      )}
      {serviceWorker && !swDismissed && (
        <div class="g-banner" role="status">
          <span>
            A service worker controls this page. It can serve cached HTML without galley's overlay; if picking stops
            working, unregister it in DevTools → Application → Service workers.
          </span>
          <button class="g-btn" title="Dismiss" onClick={() => setSwDismissed(true)}>
            <CloseIcon />
          </button>
        </div>
      )}
      <div class="g-main">
        <main class={`g-stage${width ? ' g-stage-fixed' : ''}${dragging ? ' g-dragging' : ''}`}>
          <iframe
            ref={frame}
            class="g-frame"
            src={initialPath}
            title="Site"
            style={width ? { width: `${width}px` } : undefined}
            onLoad={onFrameLoad}
          />
          {width && <span class="g-size">{width}px</span>}
        </main>
        <Drawer
          open={drawerOpen}
          width={drawerWidth}
          onOpen={setDrawerOpen}
          onResize={setDrawerWidth}
          onDragging={setDragging}
          cwd={config.cwd}
        />
      </div>
    </div>
  );
}

/** C and L toggle tools, Esc drops the tool, while focus is in the shell (the overlay handles its own). */
function useShortcuts(tool: Tool, chooseTool: (tool: Tool) => void) {
  const latest = useRef({ tool, chooseTool });
  latest.current = { tool, chooseTool };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const { tool: current, chooseTool: choose } = latest.current;
      const key = event.key.toLowerCase();
      if (key === 'c') choose(current === 'pick' ? 'none' : 'pick');
      else if (key === 'l') choose(current === 'lasso' ? 'none' : 'lasso');
      else if (key === 'escape' && current !== 'none') choose('none');
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
