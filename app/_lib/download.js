/**
 * Handing the finished bytes to the browser.
 *
 * Everything here stays local: a Blob URL points at memory in this tab, so a download never
 * touches the network — which is just as well, because `connect-src 'self'` would stop it if
 * it tried.
 */

export function downloadBytes(bytes, name, mime = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Defer the revoke: revoking immediately after click() can abort the download in some
  // browsers (older Firefox / certain download managers).
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
