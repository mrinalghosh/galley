// Listener names: what a chat subscribes as, and what the target dropdown shows.
export const RESERVED_NAMES = ['terminal', 'queue'];

const NAME = /^[A-Za-z0-9 _.-]{1,40}$/;

export type NameResult = { ok: true; name: string } | { ok: false; error: string };

export function validateListenerName(raw: string | null | undefined): NameResult {
  const name = raw?.trim() ?? '';
  if (!name) return { ok: false, error: 'missing ?name=' };
  if (!NAME.test(name)) return { ok: false, error: 'name must be 1-40 characters of letters, digits, space, "_", "." or "-"' };
  if (RESERVED_NAMES.includes(name.toLowerCase())) return { ok: false, error: `"${name}" is reserved` };
  return { ok: true, name };
}
