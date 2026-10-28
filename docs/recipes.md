# Recipes

Short answers to "my test fails, what now?". The first question is always the same: **is it a problem or is it meant?** A problem is fixed in the page (self-host the font, drop the script, remove the cookie). Something that is meant is allowed in the narrowest way that works, so that the guard keeps watching everything else.

| Situation                                          | Use                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| An API or a CDN that the page needs                | [`allow.requests`](#an-api-or-a-cdn-the-page-needs)                                |
| Several subdomains of your own site                | [`firstParty`](#your-own-subdomains)                                               |
| A cookie or a storage key the site needs           | [`allow.cookies`, `allow.localStorage`](#a-cookie-or-a-key-the-site-needs)         |
| An allowed cookie must still be safe               | [`cookieAttributes`](#a-cookie-that-is-allowed-must-still-be-safe)                 |
| A page that answers 404 on purpose                 | [`allow.errors`](#a-page-that-answers-404-on-purpose)                              |
| Nothing may load before the visitor accepts        | [`privacy.assertClean()` and `privacy.allow()`](#consent-nothing-before-the-click) |
| A test must not put an e-mail address in a request | [`watch`](#a-value-that-must-not-leave)                                            |
| A project that leaks today                         | [`mode: 'report'` and `baseline`](#a-project-that-leaks-today)                     |
| A game or an editor that reads its own canvas      | [`allow.fingerprint`](#a-game-that-reads-its-canvas)                               |
| Security headers on a staging site                 | [`headers`](#security-headers)                                                     |
| One test that must be left alone                   | [`privacyGuard: false`](#one-test-that-is-left-alone)                              |

## An API or a CDN the page needs

```ts
test.use({
  privacyGuard: {
    allow: {
      requests: [
        'api.example.com',
        { match: 'https://js.stripe.com/*', reason: 'payments, loaded on the checkout only' },
      ],
    },
  },
});
```

An allowed third party is still looked at by two warnings: **`sri`** (a script without an `integrity` attribute) and **`referrer`** (it receives the full address of the page). Fix them in the page, or switch them off with `rules: { sri: 'off' }`.

## Your own subdomains

`cdn.example.com` is another origin than `www.example.com`. If they are yours, say so once:

```ts
test.use({ privacyGuard: { firstParty: ['*.example.com'] } });
```

`firstParty` makes requests to them count as your own: they are not reported and need no `allow`. Cookies and storage are still checked.

## A cookie or a key the site needs

```ts
test.use({
  privacyGuard: {
    allow: {
      cookies: [{ match: 'session', reason: 'login' }, '_csrf*'],
      localStorage: ['theme'],
    },
  },
});
```

A cookie that was there before the test (from `storageState`, a stored login) is not the page's doing and is left alone, as long as its value is unchanged.

## A cookie that is allowed must still be safe

An allowed cookie is not looked at by the `cookies` rule any more. For the ones that identify a visitor, ask for more:

```ts
test.use({
  privacyGuard: {
    allow: { cookies: ['session', 'theme'] },
    cookieAttributes: { httpOnly: ['session*'], maxDays: 365 },
  },
});
```

Now `session` must be `HttpOnly`, no allowed cookie may be set with `SameSite=None` or live longer than a year, and every allowed cookie must be `Secure` (a cookie on `localhost` is never asked for that, a test server has no https). These are warnings, switch them to errors with `rules: { cookieAttributes: 'error' }`.

## A page that answers 404 on purpose

The 404 page of a site is served with a 404. The guard reports it as an HTTP error, like any other. Allow exactly that address:

```ts
test.describe('the 404 page', () => {
  test.use({
    privacyGuard: { allow: { errors: [/^404 http:\/\/localhost:\d+\/does-not-exist$/] } },
  });

  test('is served', async ({ page }) => {
    await page.goto('/does-not-exist');
  });
});
```

A `404` for anything else the page loads (an image that is missing) is still reported.

## Consent: nothing before the click

```ts
test('no tracker before the visitor accepts', async ({ page, privacy }) => {
  await page.goto('/');
  await privacy.assertClean(); // fails with the list if anything was loaded or stored

  privacy.allow({ requests: ['www.googletagmanager.com'], cookies: ['_ga*'] });
  await page.getByRole('button', { name: 'Accept all' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});
```

`privacy.allow()` counts from the moment you call it. Call it **before** the click that loads the tracker. The test ends with the usual check, now with the tracker allowed.

The other half, "declining stays clean", is the same test without the `allow` call: it fails when the tracker loads anyway.

## A value that must not leave

You type a test address into a form and want to be sure it never reaches a third party (not even an allowed one, such as an analytics service):

```ts
test.use({ privacyGuard: { watch: ['jane@example.com'] } });

test('signing up', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('E-mail').fill('jane@example.com');
  await page.getByRole('button', { name: 'Sign up' }).click();
});
```

The address, the body and the referrer of every request to another origin are searched, in plain text and URL-decoded. A text matches without regard to case; a regular expression matches as written. With `redact: true` the value is masked in the report.

## A project that leaks today

```ts
// playwright.config.ts
use: { privacyGuard: { mode: 'report', baseline: 'privacy-baseline.json' } }
```

1. Run the tests. Nothing fails; open the reports (or add the reporter) and see everything.
2. Fix the cheap things. Allow what is meant.
3. `PRIVACY_GUARD_UPDATE=1 npx playwright test` writes what is left into the baseline.
4. Remove `mode: 'report'`. From now on a **new** finding fails the test, a known one is listed.
5. Every fix removes lines from the baseline; delete them (or run the update again after deleting the file).

## A game that reads its canvas

The `fingerprint` rule is off until you turn it on, because reading pixels is normal for a game. When you want it for the rest of the site:

```ts
test.use({ privacyGuard: { rules: { fingerprint: 'warn' } } });

test.describe('the game', () => {
  test.use({
    privacyGuard: { rules: { fingerprint: 'warn' }, allow: { fingerprint: ['canvas'] } },
  });
});
```

## Security headers

Headers are checked on the documents of your own origin, and only when you ask. A test server often does not send them, so run these tests against a staging or preview URL that does:

```ts
test.use({
  baseURL: process.env.PREVIEW_URL,
  privacyGuard: {
    headers: {
      preset: 'recommended',
      rules: {
        'permissions-policy': 'present',
        'cache-control': /no-store/,
        'x-powered-by': 'absent',
      },
    },
  },
});
```

`recommended` asks for `Strict-Transport-Security` (https only, at least 180 days), `X-Content-Type-Options: nosniff`, a `Referrer-Policy` that does not send more than needed, protection against framing (`X-Frame-Options` or `frame-ancestors`), a `Content-Security-Policy` (a `<meta>` policy counts), and no `X-Powered-By` or `Server` with a version. `strict` adds `Permissions-Policy` and `Cross-Origin-Opener-Policy`.

The policy itself is rated by `cspQuality` (a warning): `unsafe-inline` without a nonce or hash, `unsafe-eval`, wildcards for scripts, missing `object-src`, `base-uri` and `frame-ancestors`.

## One test that is left alone

```ts
test.describe('the embedded video', () => {
  // The player is a third party and is the point of this test
  test.use({ privacyGuard: false });
});
```

Prefer an `allow` list. A test with the guard off watches nothing at all.

## A report for the whole run

```ts
reporter: [['list'], ['playwright-privacy-guard/reporter']],
```

Writes `privacy-report/index.html`: one row per problem, with the pages and tests it was seen on, and a table **Allowed on purpose** with every allow entry that was used and its reason. In GitHub Actions the same tables land in the summary of the run. Tests that fail on purpose (`test.fail()`) are left out; `{ ignore: [/canary/] }` leaves out tests by title.
