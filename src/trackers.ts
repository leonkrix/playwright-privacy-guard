import { TRACKER_CATEGORIES, TRACKER_DOMAINS, TRACKER_PRODUCTS } from './trackers-data.js';
import type { Tracker } from './types.js';

/** What a company does with the visitor's data counts as tracking. A CDN or a font host does not. */
const TRACKING_CATEGORIES = new Set([
  'ad',
  'analytics',
  'social',
  'tag-manager',
  'customer-success',
  'marketing',
]);

let products: { name: string; category: string }[] | undefined;
let domains: Map<string, number> | undefined;

function load(): { products: { name: string; category: string }[]; domains: Map<string, number> } {
  if (products === undefined || domains === undefined) {
    products = TRACKER_PRODUCTS.split('\n').map((line) => {
      const [name = '', category = '0'] = line.split('\t');
      return { name, category: TRACKER_CATEGORIES[Number(category)] ?? 'other' };
    });
    domains = new Map(
      TRACKER_DOMAINS.split('\n').map((line) => {
        const [domain = '', product = '0'] = line.split('\t');
        return [domain, Number(product)];
      }),
    );
  }
  return { products, domains };
}

/**
 * Who runs a host, when the dataset knows: `www.google-analytics.com` is Google Analytics, the
 * category says what it does (`analytics`). Subdomains are tried from the front: `a.b.example.com`,
 * then `b.example.com`, then `example.com`.
 */
export function trackerOf(host: string): Tracker | undefined {
  const { products: list, domains: map } = load();
  const labels = host.toLowerCase().split('.');
  for (let start = 0; start < labels.length - 1; start += 1) {
    const found = map.get(labels.slice(start).join('.'));
    const product = found === undefined ? undefined : list[found];
    if (product !== undefined) {
      return { entity: product.name, category: product.category };
    }
  }
  return undefined;
}

/** Is it a company whose business is data about visitors (analytics, advertising, social, ...)? */
export function isTracking(tracker: Tracker | undefined): boolean {
  return tracker !== undefined && TRACKING_CATEGORIES.has(tracker.category);
}
