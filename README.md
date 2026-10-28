# playwright-privacy-guard

A [Playwright](https://playwright.dev) fixture that fails a test when the page it opens does something it should not: talks to another origin, sets a cookie, stores data on the device, breaks its own Content Security Policy, uses a sensitive browser API or logs an error. The failure names the host, the cookie or the script, says who is behind it, and shows how to allow it if it is meant.

[![CI](https://github.com/leonkrix/playwright-privacy-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/leonkrix/playwright-privacy-guard/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/playwright-privacy-guard)](https://www.npmjs.com/package/playwright-privacy-guard)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/leonkrix/playwright-privacy-guard/badge)](https://scorecard.dev/viewer/?uri=github.com/leonkrix/playwright-privacy-guard)

```text
Privacy guard: 3 problems (3 errors) on /

Requests to other origins (1)
  - www.google-analytics.com  [Google Analytics, analytics]
    3 requests to www.google-analytics.com
    kinds: script, ping x2
    first: https://www.google-analytics.com/analytics.js
    from: https://example.com/

Cookies (1)
  - cookie _ga
    cookie "_ga" is set by the page
    set by: document.cookie in a script (https://example.com/_next/static/app.js:1:20431)
    stored for example.com/: expires in 729 days
    not Secure, readable by scripts, SameSite=Lax

Data stored on the device (1)
  - localStorage "theme"
    the page stores "theme" in localStorage
    origin: https://example.com
    written by https://example.com/_next/static/app.js:1:9921

If this is meant, allow it where the guard is set up ...
```

## Why

"We do not use cookies and nothing leaves the browser" is a promise that a page keeps until somebody adds a font from a CDN, an analytics snippet or a widget. A privacy policy and a cookie banner (or the lack of one) rest on it. This package turns the promise into a test: **every test that opens a page checks it, without a single line in the test**.

It was extracted from the tests of [leonkrix.dev](https://leonkrix.dev), a site that promises exactly that: no third-party request, no cookie, nothing in the storage of the device.

It is the sibling of [playwright-layout-guard](https://github.com/leonkrix/playwright-layout-guard), which does the same for things that move on the page.

## Install

```bash
npm install --save-dev playwright-privacy-guard
```

`@playwright/test` 1.45 or newer is a peer dependency. Chromium, Firefox and WebKit are supported. The package has no runtime dependencies.

## Use

Import `test` and `expect` from this package instead of from `@playwright/test`:

```ts
import { expect, test } from 'playwright-privacy-guard';

test('the home page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
```

That is all. When the test ends, the guard looks at everything the page did and fails the test if there is a problem. Nothing is checked that you did not open, and a test that already failed keeps its own error (the report is attached to it).

Already have your own fixtures? Merge them: `mergeTests(base, privacyTest)`.

### What it checks

| Rule               | What it finds                                                                                                   | Default |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ------- |
| `requests`         | Requests to other origins: scripts, images, fetch, beacons, web sockets, workers, and link hints (`preconnect`) | error   |
| `insecure`         | Requests over `http:` or `ws:` (not to localhost)                                                               | error   |
| `cookies`          | Every cookie in the browser, and every `Set-Cookie` of a response, also one the browser rejected                | error   |
| `cookieAttributes` | An allowed cookie that is not `Secure`, not `HttpOnly` (by name), set with `SameSite=None` or lives too long    | off     |
| `storage`          | localStorage, sessionStorage, IndexedDB, Cache Storage and service workers: what was written and what is left   | error   |
| `csp`              | Content Security Policy violations: what was blocked, by which directive, from which script                     | error   |
| `errors`           | Console errors, uncaught exceptions, failed requests and HTTP 4xx/5xx                                           | error   |
| `apis`             | Location, camera and microphone, screen capture, notifications, WebRTC, clipboard read, MIDI, Bluetooth, USB    | error   |
| `forms`            | Forms and `ping` links that send to another origin                                                              | error   |
| `leaks`            | Values you list in `watch` (a test e-mail address) found in a request to a third party                          | error   |
| `referrer`         | An allowed third party that receives the full address of the page                                               | warn    |
| `sri`              | An allowed third-party script or stylesheet without an `integrity` attribute                                    | warn    |
| `headers`          | Response headers of your documents against a preset (`recommended`, `strict`) and rules of your own             | off     |
| `cspQuality`       | A weak policy: `unsafe-inline`, `unsafe-eval`, wildcards, no `object-src`, `base-uri`, `frame-ancestors`        | off     |
| `fingerprint`      | Canvas read-back, graphics card name, audio rendering, battery, many font checks                                | off     |

A finding says **what** (the host, the cookie, the key), **who** when the company is known (about 2,100 products from the [third-party-web](https://github.com/patrickhulce/third-party-web) dataset: `Google Analytics, analytics`), **where it came from** (the script and line, or the frame and kind of request) and **how often**.

### When something is meant

Allow it in the narrowest way that works, and say why:

```ts
import { test } from 'playwright-privacy-guard';

test.use({
  privacyGuard: {
    allow: {
      // A host, any subdomain, an origin, an address prefix or a regular expression
      requests: ['api.example.com', { match: '*.stripe.com', reason: 'payments' }],
      cookies: ['session', '_csrf*'],
      localStorage: ['theme'],
      apis: [{ match: 'geolocation', reason: 'the map asks where you are' }],
      // The 404 page of the site answers with a 404 on purpose
      errors: [/^404 http:\/\/localhost:\d+\/does-not-exist$/],
    },
  },
});
```

Set the options for the whole project in `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';
import type { PrivacyGuardTestOptions } from 'playwright-privacy-guard';

export default defineConfig<PrivacyGuardTestOptions>({
  use: {
    privacyGuard: { allow: { requests: ['api.example.com'] }, headers: 'recommended' },
  },
});
```

Playwright replaces an option object as a whole when a file sets it again. To add to the lists of the project, merge them: `mergeAllow(base, extra)` is exported.

Switch the guard off for one test (and say why):

```ts
test.use({ privacyGuard: false });
```

### Options

| Option             | Default     | Meaning                                                                                                                                 |
| ------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`             | `'enforce'` | `'report'` never fails a test: the report is attached and that is all. Use it to look before you commit to the rules                    |
| `allow`            | nothing     | What the page may do, per rule (see below)                                                                                              |
| `rules`            | see table   | `'error'` fails the test, `'warn'` only reports, `'off'` does not look: `rules: { referrer: 'off', fingerprint: 'warn' }`               |
| `firstParty`       | `[]`        | Origins that count as your own besides the page and the `baseURL` (`['*.example.com']`)                                                 |
| `watch`            | `[]`        | Values that must never reach a third party: `['jane@example.com', /\b4242\d{12}\b/]`                                                    |
| `cookieAttributes` | off         | What is asked of the cookies that are allowed: `{ secure: true, httpOnly: ['session*'], noSameSiteNone: true, maxDays: 90 }`, see below |
| `headers`          | off         | `'recommended'`, `'strict'` or `{ preset, rules }` where a rule is `'present'`, `'absent'`, a value, a regular expression or a function |
| `baseline`         | none        | A file of known findings (see "Adopting it in a project that leaks today")                                                              |
| `redact`           | `false`     | Keep query strings and values out of the report                                                                                         |
| `maxObservations`  | `5000`      | A page that makes more requests than this is cut off (the report says so)                                                               |

The lists of `allow`: `requests`, `insecure`, `cookies`, `localStorage`, `sessionStorage`, `indexedDB`, `cacheStorage`, `serviceWorkers` (`true`), `apis`, `fingerprint`, `errors`, `csp` and `integrity`. A host is written as `example.com` (that host, any port), `*.example.com` (any subdomain, not the bare domain), `localhost:4411` (with the port), `https://cdn.example.com` (that origin) or `https://cdn.example.com/lib/*` (an address prefix). Names accept `*` at the end or anywhere (`_ga*`).

Every entry may carry a reason, also in `apis` and `fingerprint` (`{ match: 'canvas', reason: 'the game draws on it' }`). The report lists what each entry really let pass under **Allowed on purpose**, with the reason, so that an allow list does not become a place where things disappear.

#### Allowed cookies are still asked for their attributes

A cookie that you allow is not looked at by the `cookies` rule any more, but a cookie that identifies a visitor should still be safe. Turn on `cookieAttributes` (`rules: { cookieAttributes: 'warn' }`, or set `cookieAttributes: { ... }`) and every allowed cookie is checked: it must be `Secure` (not asked on `localhost` and other machine-local hosts), the names in `httpOnly` must be `HttpOnly`, a cookie that a header sets with `SameSite=None` is found (only when the header says so, because browsers differ in what they report as the default), and `maxDays` limits the lifetime. The finding says which attribute is missing.

The options are checked when the test starts, so a typo (`allow.cookie`, a rule that does not exist) fails at once and says which option is wrong.

### Look at the page in the middle of a test

The fixture `privacy` is the guard of the test:

```ts
test('accepting the banner', async ({ page, privacy }) => {
  await page.goto('/');

  // Nothing may be loaded before the visitor decides
  await privacy.assertClean();

  // From now on the consent provider may be asked
  privacy.allow({ requests: ['consent.example.com'], cookies: ['consent'] });
  await page.getByRole('button', { name: 'Accept' }).click();

  console.log(privacy.findings); // what was found so far, without the state of the browser
  const findings = await privacy.check(); // everything, with cookies and storage as they are now
  await privacy.forget(); // count what is there now as known
});
```

`privacy.allow()` applies **from the moment of the call**: a request made earlier is still judged by what was allowed then. That is what makes the "nothing before consent" test possible.

### Results

- **The failure message** groups the findings by rule, names the page, and ends with the `allow` block that would allow them.
- **Attachments** on every test with findings: `privacy-report.json` (everything, stable format), `privacy-report.html` (a page without script, light and dark, open it from the Playwright HTML report) and `privacy-report.txt`.
- **Warnings** do not fail the test. They are attached and shown as test annotations.
- **Allowed on purpose** is a list in the text and the HTML report of a test (and in the report of the whole run): what each allow entry let pass, how often, and the reason you gave. A test that found nothing but used an entry attaches only the JSON, so the report of the run can list it.
- **A reporter** collects all tests into one page, with one row per problem and the pages and tests it was seen on:

  ```ts
  // playwright.config.ts
  export default defineConfig({
    reporter: [['list'], ['playwright-privacy-guard/reporter', { outputDir: 'privacy-report' }]],
  });
  ```

  It writes `privacy-report/index.html`, `summary.md` and `summary.json`, and adds the table to the summary of a GitHub Actions run (`GITHUB_STEP_SUMMARY`).

  The page of the run also has the **Allowed on purpose** table over all tests, so a reviewer sees in one place what the project has decided to let through and why. Tests that are meant to fail (`test.fail()`) are left out, and `{ ignore: [/canary/] }` leaves out tests by title, for the ones that make a page misbehave on purpose.

### Adopting it in a project that leaks today

1. Start with `mode: 'report'`. Nothing fails, and you see everything in the reports.
2. Fix what is wrong. Allow what is meant, with a reason.
3. For what you cannot fix yet, use a baseline: findings that are in the file are listed as known and do not fail the test; **a new finding does**.

   ```ts
   test.use({ privacyGuard: { baseline: 'privacy-baseline.json' } });
   ```

   ```bash
   PRIVACY_GUARD_UPDATE=1 npx playwright test   # writes the findings of this run into the file
   ```

   The file is sorted, so a review shows exactly what was added.

### Without the fixture

If you build your own fixtures, install the guard on a context before a page is opened:

```ts
import { installPrivacyGuard } from 'playwright-privacy-guard';

const privacy = await installPrivacyGuard(
  context,
  { allow: { requests: ['api.example.com'] } },
  baseURL,
);
await page.goto('/');
await privacy.assertClean();
```

## Command line

No tests needed: point the guard at addresses and read what it finds. This is how the [trial on public pages](docs/survey.md) was made.

```sh
npx playwright-privacy-guard scan https://example.com
npx playwright-privacy-guard scan https://staging.example.com/ https://staging.example.com/pricing --fail-on error
npx playwright-privacy-guard scan --file pages.txt --format markdown --out privacy-report.md
```

Every address is opened in a fresh browser, left alone for four seconds and scrolled once, without clicks and without accepting anything. The report names every other origin, cookie and stored value, the company behind it where the dataset knows it, and the script that did it, like the failure message of a test. It needs Playwright and its browser (`npx playwright install chromium`).

| Option                | What it does                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `--file <path>`       | More addresses, one per line (`#` starts a comment)                                                                   |
| `--browser <name>`    | `chromium` (default), `firefox` or `webkit`                                                                           |
| `--format <name>`     | `text` (default), `json`, `markdown` or `html`                                                                        |
| `--out <path>`        | Write the report to a file instead of the console                                                                     |
| `--fail-on <level>`   | `error` (default), `warn` or `never`: when the exit code is 1                                                         |
| `--options <path>`    | A JSON file with the [options](#options) of the guard, for example `{ "allow": { "requests": ["cdn.example.com"] } }` |
| `--all-rules`         | Also look at headers, the policy, fingerprinting and cookie attributes                                                |
| `--wait <seconds>`    | How long to leave a page alone after the load (default 4)                                                             |
| `--no-scroll`         | Do not scroll through the page                                                                                        |
| `--timeout <seconds>` | How long a page may take to load (default 45)                                                                         |
| `--device <name>`     | A [device of Playwright](https://playwright.dev/docs/emulation#devices), for example `"iPhone 13"`                    |

The exit code is 0 when nothing at the level of `--fail-on` was found, 1 when something was, and 2 when the command was wrong or a page could not be loaded. The text report ends with the part of an options file that would allow what it found; give each entry a reason (`{ "match": "...", "reason": "..." }`) and the report lists it under "Allowed on purpose". In a pipeline:

```yaml
- run: npx playwright install --with-deps chromium
- run: npx playwright-privacy-guard scan https://staging.example.com --options privacy-guard.json
```

A page that blocks automated browsers (a bot wall answers 403) is reported as it answers.

## What it does and does not catch

It sees what Playwright and a few hooks in the page can see:

- **Requests** of every kind that Playwright reports for the context (pages, frames, workers, web sockets, beacons) and the link hints in the HTML. Requests of a dedicated worker are reported, but with the page as origin, not the worker.
- **Cookies** from the browser and from the headers of every response. A `Set-Cookie` that the browser refuses (for example a `Secure` cookie over `http:`) is reported as one the browser did not keep.
- **Storage**: the calls to `setItem`, `indexedDB.open`, `caches.open` and `serviceWorker.register` with the script that made them, and the state of every frame at the end. A write like `localStorage.key = 1` has no call to hook; the state at the end still finds it. Pages that were closed during the test are covered by the calls only.
- **Firefox and WebKit** ignore a less strict `Referrer-Policy` across sites, so the `referrer` rule finds fewer cases there; that is the browser protecting the visitor.
- **A link to another website** that opens in a new tab is the page leaving the site: what that website does (its requests, its cookies) is not a leak of yours and is left out. A new tab on your own site is judged like any page. The page itself is still judged, and so is a link that you follow in the same tab (the test chose to go there, and the next page is judged on its own).
- It looks at the page **in the test**, in the state the test leaves it in. A cookie that only appears after a purchase is found by a test that makes the purchase.
- It cannot see what happens on the server (what your backend sends to a third party), in a native app, or in browser extensions.
- A page can detect and defeat the hooks. The guard is meant to catch mistakes, not an adversary.

This is a test tool, not legal advice. A green run does not mean that a privacy policy is correct.

## How well does it work on real pages?

The package was tried on 29 public pages (sites that say they do not track, documentation sites, news sites) in Chromium, Firefox and WebKit, next to a record of the same page made without the package: every request, cookie and storage key the browser itself reports. [The survey](docs/survey.md) has the numbers, what the first version got wrong and what stays a finding on purpose. The script is in `scripts/survey.mjs`.

## Data

The names of companies come from [third-party-web](https://github.com/patrickhulce/third-party-web) by Patrick Hulce (MIT), whose data comes from the [HTTP Archive](https://httparchive.org). A trimmed copy is part of this package (about 100 KB); `pnpm trackers` makes it again.

## Status and versioning

Version `0.x`: the API can change in a minor version, and the changelog says so. Releases follow [semantic versioning](https://semver.org) from `1.0.0`.

## Packages and releases

The package is published from GitHub Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements): each version links to the commit and the workflow run that built it. See [docs/releasing.md](docs/releasing.md). The repository is checked by CodeQL, OpenSSF Scorecard and a weekly dependency audit; Dependabot keeps dependencies and actions current, and every action is pinned to a commit.

## Development

```bash
pnpm install
pnpm exec playwright install chromium firefox webkit
pnpm check   # lint, format, types, unit tests, build, package lint, browser tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/how-it-works.md](docs/how-it-works.md).

## Origin

The guard was built for [leonkrix.dev](https://leonkrix.dev), a site that promises no cookies, nothing stored on the device and no request to any other origin, and where every browser test runs with it. It started as a few checks in that test suite and became a package when they grew, next to [playwright-layout-guard](https://github.com/leonkrix/playwright-layout-guard), which came out of the same suite.

## License

[MIT](LICENSE) © Leon Krix
