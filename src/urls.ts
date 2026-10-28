/** An address, or `undefined` when it is not one (relative, broken). */
export function parseUrl(address: string): URL | undefined {
  try {
    return new URL(address);
  } catch {
    return undefined;
  }
}

/** localhost, 127.x.x.x and ::1: addresses that never leave the machine */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

/** Only requests that really use the network: not `data:`, `blob:`, `about:` or browser pages */
export function isNetworkUrl(address: URL): boolean {
  return ['http:', 'https:', 'ws:', 'wss:', 'ftp:'].includes(address.protocol);
}

/** `/docs/intro` of `https://example.com/docs/intro?a=1#top`, anything else as it is */
export function pathOf(address: string): string {
  const parsed = parseUrl(address);
  return parsed === undefined || !isNetworkUrl(parsed) ? address : parsed.pathname;
}

/** The address without query string and fragment, for a report that must not carry values. */
export function redactUrl(address: string): string {
  const parsed = parseUrl(address);
  if (parsed === undefined || !isNetworkUrl(parsed)) {
    return address;
  }
  const query = parsed.search === '' ? '' : '?...';
  return `${parsed.origin}${parsed.pathname}${query}`;
}

/** Is the address secure for a page: https or wss, or a machine-local address. */
export function isSecure(address: URL): boolean {
  return (
    address.protocol === 'https:' || address.protocol === 'wss:' || isLocalHost(address.hostname)
  );
}
