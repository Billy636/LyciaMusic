let applicationStyleNonce: string | undefined;

/** Retain Tauri's authorized style nonce before Vue removes the boot skeleton. */
export function getApplicationStyleNonce(): string {
  if (applicationStyleNonce !== undefined) return applicationStyleNonce;
  if (typeof document === 'undefined') return '';

  // Read the IDL property: browsers hide nonce values from getAttribute().
  // Script nonces can have a different authorization and must not be reused.
  applicationStyleNonce = Array.from(document.querySelectorAll<HTMLStyleElement>('style[nonce]'))
    .map((style) => style.nonce)
    .find(Boolean) ?? '';
  return applicationStyleNonce;
}
