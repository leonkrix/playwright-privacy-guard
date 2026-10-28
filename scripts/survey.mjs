// A trial of the guard against public pages: does it see what the browser sees, and how much noise
// does it make?
//
// Every page is opened once (a normal page load, no clicks, no consent given, no crawling), left
// alone for a few seconds and scrolled from top to bottom once like a reader would. The guard runs
// with every rule switched on. Next to it, the script keeps its own record of the same page, made
// without the package: every request Playwright reports, the cookies of the browser and the keys of
// localStorage and sessionStorage. The two are compared, so a request the guard missed or a finding
// that nothing in the browser backs up shows up. Run `pnpm build` first (the script uses the built
// package).
//
//   node scripts/survey.mjs                         all pages, in Chromium
//   node scripts/survey.mjs --browser firefox       or webkit
//   node scripts/survey.mjs --only bbc              only the pages whose address contains "bbc"
//
// The result goes to survey-results/ as JSON and as tables on the console. It is not committed.
import { mkdir, writeFile } from 'node:fs/promises';

import { chromium, devices, firefox, webkit } from '@playwright/test';

import { installPrivacyGuard } from '../dist/index.js';

const PAGES = [
  // Sites that say they do not track
  'https://plausible.io/',
  'https://signal.org/',
  'https://www.gnu.org/',
  'https://en.wikipedia.org/wiki/Web_browser',
  'https://news.ycombinator.com/',
  // Documentation and project sites (the same list as the survey of playwright-layout-guard)
  'https://playwright.dev/docs/intro',
  'https://react.dev/learn',
  'https://developer.mozilla.org/en-US/docs/Web/CSS/grid',
  'https://nodejs.org/en/learn/getting-started/introduction-to-nodejs',
  'https://docs.github.com/en/get-started/start-your-journey/about-github-and-git',
  'https://vite.dev/guide/',
  'https://tailwindcss.com/docs/installation',
  'https://astro.build/',
  'https://web.dev/articles/cls',
  'https://www.python.org/',
  'https://www.rust-lang.org/',
  'https://kubernetes.io/docs/concepts/overview/',
  'https://vuejs.org/guide/introduction.html',
  'https://svelte.dev/docs/svelte/overview',
  'https://angular.dev/overview',
  'https://docs.python.org/3/tutorial/index.html',
  'https://www.typescriptlang.org/docs/handbook/intro.html',
  'https://nextjs.org/docs',
  'https://go.dev/doc/',
  // News sites, which are known to talk to many others
  'https://www.bbc.com/news',
  'https://www.theguardian.com/international',
  'https://www.spiegel.de/',
  'https://edition.cnn.com/',
  'https://www.nytimes.com/',
];

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const only = option('--only');
const browserName = option('--browser') ?? 'chromium';
const engines = { chromium, firefox, webkit };
if (engines[browserName] === undefined) {
  throw new Error(`unknown browser ${browserName}`);
}

/** Every rule on, so that the survey sees what the guard can see at most */
const OPTIONS = {
  headers: 'recommended',
  cookieAttributes: {},
  rules: { fingerprint: 'warn', cspQuality: 'warn' },
};

async function scroll(page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let at = 0; at < Math.min(height, 12000); at += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), at);
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
}

const originOf = (address) => {
  try {
    const url = new URL(address);
    return /^(https?|wss?):$/.test(url.protocol) ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

const browser = await engines[browserName].launch();
const results = [];

for (const url of PAGES) {
  if (only !== undefined && !url.includes(only)) {
    continue;
  }
  const context = await browser.newContext(
    browserName === 'chromium'
      ? { ...devices['Desktop Chrome'] }
      : { viewport: { width: 1280, height: 800 } },
  );
  const guard = await installPrivacyGuard(context, OPTIONS);
  // The record made without the package
  const requested = new Set();
  // The origins of the page itself, which the browser asked for in a navigation (and a redirect)
  const navigated = new Set();
  context.on('request', (request) => {
    const origin = originOf(request.url());
    if (origin !== undefined) {
      requested.add(origin);
      if (request.isNavigationRequest() && request.frame().parentFrame() === null) {
        navigated.add(origin);
      }
    }
  });
  const page = await context.newPage();
  const entry = { url, status: 'ok' };
  const started = Date.now();
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    entry.http = response?.status();
    await page.waitForTimeout(4000);
    await scroll(page);
  } catch (error) {
    entry.status = `error: ${String(error.message).split('\n')[0]}`;
  }
  const own = originOf(page.url());
  entry.finalUrl = page.url();
  const report = await guard.report().catch((error) => {
    entry.status = `report failed: ${String(error.message).split('\n')[0]}`;
    return undefined;
  });
  if (report !== undefined) {
    const byRule = {};
    for (const found of report.findings) {
      (byRule[found.rule] ??= []).push({
        level: found.level,
        subject: found.subject,
        summary: found.summary,
        count: found.count,
        tracker:
          found.tracker === undefined
            ? undefined
            : `${found.tracker.entity} (${found.tracker.category})`,
        source: found.source?.url,
      });
    }
    entry.byRule = byRule;
    entry.errors = report.counts.errors;
    entry.warnings = report.counts.warnings;
    entry.observations = report.observations;
    entry.dropped = report.dropped;
  }
  // The comparison: what the browser itself says
  const cookies = await context.cookies().catch(() => []);
  const storage = await page
    .evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    }))
    .catch(() => ({ local: [], session: [] }));
  const guardOrigins = new Set(
    (entry.byRule?.requests ?? []).map((item) => item.subject.replace(/^https?:\/\//, '')),
  );
  const theirOrigins = [...requested].filter((origin) => origin !== own && !navigated.has(origin));
  entry.truth = {
    otherOrigins: theirOrigins.length,
    cookies: cookies.length,
    localStorageKeys: storage.local.length,
    sessionStorageKeys: storage.session.length,
  };
  // Hosts the browser reached that the guard does not list as a request (a host, not an origin)
  const guardHosts = new Set([...guardOrigins].map((item) => item.replace(/:\d+$/, '')));
  entry.missedHosts = theirOrigins
    .map((origin) => new URL(origin).host)
    .filter((host) => !guardHosts.has(host) && !guardHosts.has(host.replace(/:\d+$/, '')));
  entry.extraHosts = [...guardHosts].filter(
    (host) => !theirOrigins.some((origin) => new URL(origin).host === host),
  );
  const guardCookieNames = new Set(
    (entry.byRule?.cookies ?? []).map((item) => item.subject.replace(/^cookie /, '')),
  );
  entry.missedCookies = [...new Set(cookies.map((item) => item.name))].filter(
    (name) => !guardCookieNames.has(name),
  );
  entry.extraCookies = (entry.byRule?.cookies ?? [])
    .filter((item) => !cookies.some((cookie) => item.subject === `cookie ${cookie.name}`))
    .map((item) => `${item.subject}: ${item.summary}`);
  const guardStorage = (entry.byRule?.storage ?? []).map((item) => item.subject);
  entry.storageSubjects = guardStorage;
  entry.missedStorage = [
    ...storage.local.map((key) => ({ area: 'localStorage', key })),
    ...storage.session.map((key) => ({ area: 'sessionStorage', key })),
  ]
    .filter(
      ({ area, key }) =>
        !guardStorage.some((subject) => subject.includes(area) && subject.includes(key)),
    )
    .map(({ area, key }) => `${area} ${key}`);
  entry.cookieDomains = [...new Set(cookies.map((item) => item.domain))];
  entry.guardCookies = (entry.byRule?.cookies ?? []).length;
  entry.guardStorage = (entry.byRule?.storage ?? []).length;
  entry.seconds = Math.round((Date.now() - started) / 1000);
  results.push(entry);
  const count = (rule) => (entry.byRule?.[rule] ?? []).length;
  console.log(
    `${url.slice(0, 62).padEnd(62)} req ${String(count('requests')).padStart(3)}/${String(entry.truth.otherOrigins).padEnd(3)} cookies ${String(count('cookies')).padStart(2)}/${String(cookies.length).padEnd(2)} storage ${String(count('storage')).padStart(2)}/${String(storage.local.length + storage.session.length).padEnd(2)} errors ${String(count('errors')).padStart(2)} csp ${String(count('csp')).padStart(2)} headers ${String(count('headers') + count('cspQuality')).padStart(2)} fp ${String(count('fingerprint'))} ${entry.status === 'ok' ? '' : entry.status}`,
  );
  await context.close();
}

await browser.close();

// The names of the companies the guard put on hosts: to be read by a person
const labels = new Map();
for (const entry of results) {
  for (const item of entry.byRule?.requests ?? []) {
    if (item.tracker !== undefined) {
      labels.set(item.subject, item.tracker);
    }
  }
}
console.log('\nHosts the guard put a company on:');
for (const [host, label] of [...labels].sort()) {
  console.log(`  ${host.padEnd(48)} ${label}`);
}
const missed = results.filter((entry) => entry.missedHosts?.length > 0);
console.log(
  `\nPages where the browser reached a host that the guard does not list: ${String(missed.length)}`,
);
for (const entry of missed) {
  console.log(`  ${entry.url}: ${entry.missedHosts.slice(0, 6).join(', ')}`);
}
for (const [title, key] of [
  ['Hosts the guard lists and the browser did not reach', 'extraHosts'],
  ['Cookies the browser holds and the guard does not list', 'missedCookies'],
  ['Cookies the guard lists and the browser does not hold', 'extraCookies'],
  ['Storage keys the browser holds and the guard does not list', 'missedStorage'],
]) {
  console.log(`\n${title}:`);
  for (const entry of results) {
    if (entry[key]?.length > 0) {
      console.log(`  ${entry.url.slice(8, 50)}: ${entry[key].slice(0, 8).join(' | ')}`);
    }
  }
}

await mkdir('survey-results', { recursive: true });
const file = `survey-results/survey-${browserName}${only === undefined ? '' : `-${only.replace(/\W/g, '')}`}.json`;
await writeFile(file, JSON.stringify(results, null, 2));
console.log(`\nwritten to ${file}`);
