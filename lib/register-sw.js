// Registers the service worker that makes the app work offline, and reports when a newer
// version of the app is sitting behind it.
//
// Service workers only exist in a secure context (HTTPS or localhost). This app is explicitly
// meant to run from file:// and plain-http LAN too, where `navigator.serviceWorker` is simply
// absent — so every failure here is non-fatal and silent. Offline support is an enhancement;
// nothing about the tools depends on it.

/**
 * @param {(apply: () => void) => void} [onUpdateReady] called when a new version has finished
 *   installing, with the function that switches to it.
 * @returns {() => void} a cleanup function, so this can be used directly as an effect.
 */
export function registerServiceWorker(onUpdateReady) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;
  // sw.js is written by scripts/generate-sw.mjs into the export, so it does not exist in dev.
  if (process.env.NODE_ENV !== 'production') return undefined;

  let cancelled = false;
  const announce = (registration) => {
    if (!cancelled) onUpdateReady?.(() => applyUpdate(registration));
  };

  const watch = (registration) => {
    if (!registration) return;
    // Already waiting when this tab loaded — the usual case for someone who has been here
    // before and has another tab open.
    if (registration.waiting && navigator.serviceWorker.controller) announce(registration);

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        // `controller` is what distinguishes an update from a first install: on a first visit
        // there is nothing to replace, and telling someone to reload would be nonsense.
        if (installing.state === 'installed' && navigator.serviceWorker.controller) announce(registration);
      });
    });
  };

  const register = () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then(watch, () => {
      /* unsupported, blocked, or served from somewhere a worker cannot be registered */
    });
  };

  // Registration is deferred to `load` so precaching does not compete with the first paint —
  // but by the time React runs an effect the load event has usually already fired, and
  // waiting for one that will never come again would silently disable offline support.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });

  return () => {
    cancelled = true;
  };
}

/**
 * Switch to the version that is waiting, then reload into it.
 *
 * A plain reload is not enough and it is worth writing down why: the waiting worker only takes
 * over once no client is controlled by the old one, and reloading hands the new page straight
 * back to the old worker. Measured — the button did nothing at all before this. So the waiting
 * worker is asked to step aside, and the reload happens once it has.
 */
export function applyUpdate(registration) {
  const waiting = registration?.waiting;
  if (!waiting) {
    window.location.reload();
    return;
  }

  let reloaded = false;
  const reload = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
  waiting.postMessage({ type: 'skip-waiting' });
  // If the worker never takes over — an old browser, a blocked message — reload anyway rather
  // than leaving someone staring at a button that did nothing.
  setTimeout(reload, 2000);
}
