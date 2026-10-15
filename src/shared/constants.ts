/** Path prefix the proxy reserves for itself. Never forwarded to the target. */
export const PREFIX = '/__galley';

/** Per-project state folder, under --cwd. Holds comments, screenshots and the token. */
export const DATA_DIR = '.galley';

export const DEFAULT_PORT = 5300;

/** Cookie that carries the session token for browser calls to PREFIX. */
export const TOKEN_COOKIE = 'galley_token';

/** Query parameter that carries the token for callers without cookies (CLI, Monitor). */
export const TOKEN_PARAM = 'token';

/** Source-location attribute added by the Vite plugin: "path/from/cwd.tsx:line:col". */
export const SRC_ATTR = 'data-galley-src';

/** Element that hosts the overlay's shadow root. The picker must skip it. */
export const OVERLAY_HOST_TAG = 'galley-overlay';

export const MAX_SELECTED_ELEMENTS = 20;
