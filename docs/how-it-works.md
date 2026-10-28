# How it works

The guard has two halves: what **watches** (it collects plain facts) and what **judges** (pure functions that turn facts into findings). They are kept apart on purpose: the judging is unit tested without a browser, the watching is tested with real pages in three browsers.

```
  page in the browser                      the test (Node)
  ┌──────────────────────┐   events    ┌────────────────────────────────────────────┐
  │ page script (hooks)  │ ─────────▶  │ observations (requests, responses,         │
  │ - cookie, storage    │             │ console, page errors, page events)         │
  │ - policy violations  │             │                 │                          │
  │ - sensitive APIs     │             │                 ▼                          │
  │ - links, forms, meta │             │ rules (pure) ◀── options, allow lists      │
  └──────────────────────┘             │                 │                          │
                                       │                 ▼                          │
         Playwright events ─────────▶  │ findings ─▶ message, JSON, HTML, reporter  │
                                       └────────────────────────────────────────────┘
```

## Watching

**In Node**, the guard listens to the events Playwright already has for the browser context: `request`, `response`, `requestfailed`, `console`, `pageerror` and `websocket`. That covers pages, popups, frames, workers and beacons in all three browsers, with no change to the page. Two things are asked in a second step, because they are asynchronous: the full list of response headers (for `Set-Cookie` and for the security headers) and the full list of request headers (for the referrer).

**In the page**, a small script is added with `addInitScript` before anything of the page runs. It only watches; every hook calls the original and never changes the result:

- the `document.cookie` setter and the Cookie Store API,
- `Storage.setItem`, `indexedDB.open`, `caches.open` and `serviceWorker.register`,
- the `securitypolicyviolation` event,
- the sensitive APIs of the `apis` rule (and, when asked for, the ways of recognising a browser),
- a `MutationObserver` for what the HTML says without making a request: link hints, forms, `ping` links, scripts and styles with and without `integrity`, and `<meta http-equiv="Content-Security-Policy">`.

The script has to be self-contained: Playwright sends it to the browser as text. It is compiled with plain `tsc` for that reason, and a hook that a browser does not allow is skipped without a sound.

Each call that is hooked also sends a stack trace. Its first frame that is a real address is the script that did it (`firstFrame` knows the three formats of Chromium, Firefox and WebKit). WebKit leaves the page's frame out when a script calls a hook from its top level, so the address of the running script (`document.currentScript`) is the fallback.

**At the end** (and whenever `privacy.check()` is called) the guard takes a snapshot: the cookies of the context, and for every frame of every open page the keys of localStorage and sessionStorage, the IndexedDB databases, the caches and the service workers. What was in the browser before the test (a `storageState`) is subtracted. The snapshot finds what the hooks cannot see (`localStorage.key = 1`, a cookie with `HttpOnly`), the hooks find what the snapshot cannot (a value that was written and removed again, a page that was closed) and say who wrote it.

## Judging

Every fact is an `Observation` with the time it happened. A rule is a function `(observations, snapshot, context) => Finding[]`:

- It decides what counts as "your own": the origin of the page at the time (the address of the last main-frame navigation the test made), the `baseURL`, and the `firstParty` entries. A navigation of the main frame is never a leak (the test chose to go there).
- It asks the **allow lists at the time of the observation** (`privacy.allow()` adds to them from then on). State that is judged at the end (cookies, storage) uses the lists as they are at the end.
- It groups what belongs together: ten requests to one host are one finding with a count.
- It names the company behind a host (`trackerOf`: the dataset is looked up from the full name up to the registrable part).

Then `evaluate` puts all findings in one order (errors first, then the order of the rules, then by how often), `formatFindings` writes the message, `renderHtml` the page, and the reporter combines the reports of all tests.

## Why a few decisions are the way they are

- **`page` is a dependency of the fixture.** The storage has to be read before the pages are closed, and Playwright closes them before it tears down fixtures that do not depend on them.
- **`context.on('request')`, not `page.on`.** Popups and workers need no extra wiring, and nothing is missed between the creation of a page and its first listener.
- **The first-party origin follows the page, not the first address.** A test may navigate: a request is judged against the page that made it.
- **Warnings exist.** `referrer` and `sri` are things a team wants to know and may not want to fail a build for; a rule can be a warning, an error or off.
- **A baseline is keyed by rule, subject and page,** not by a hash of the details, so that a changed address or count does not make a known problem look new.
- **The tracker list is generated and committed.** A build, an install and a test run need no network and no 8 MB dependency. `pnpm trackers` makes it again from `third-party-web`.
- **No fuzzy matching, no regular expressions where a host will do.** The notation for hosts is small and written down; a regular expression is there for the rest.

## What is not done, on purpose

- No network access of its own: the guard never makes a request.
- No storage of its own: it writes nothing to the browser and nothing to disk, except the files you ask for (baseline, reports).
- No cookie, storage or request filtering: it watches, it does not block. (Blocking would change the page that is tested.)
- No CDP: everything works in Chromium, Firefox and WebKit alike. The one thing that would need it is the initiator of a request (which script made it); the guard answers that for storage and cookies with stack traces, and for requests with the frame and the kind of request.
