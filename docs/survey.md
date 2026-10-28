# Trial on public pages

Before a 1.0 the guard was tried on 29 public pages: sites that say they do not track (Plausible, Signal, GNU, Wikipedia, Hacker News), 19 documentation and project sites (most of them also in the trial of [playwright-layout-guard](https://github.com/leonkrix/playwright-layout-guard)) and five news sites that are known to talk to many others (BBC, The Guardian, Spiegel, CNN, The New York Times). Each page was opened once in Chromium, Firefox and WebKit at desktop size, left alone for four seconds and scrolled from top to bottom and back, like a reader would. No clicks, no cookie banner accepted, no sign-in, no crawling. Every rule of the guard was switched on, including the header preset, the policy rating, fingerprinting and cookie attributes.

Next to the guard the script keeps **its own record of the same page, made without the package**: every request Playwright reports for the browser context, the cookies the browser holds at the end and the keys of `localStorage` and `sessionStorage`. The two are compared, so a request, a cookie or a key that the guard missed would show up. `pnpm build && pnpm survey` repeats it (about ten minutes per browser, needs the network). Pages change, so the numbers are a snapshot from October 2026, taken with version 0.3.0 and the fixes described below.

## Result

|                                                                   | Chromium | Firefox  | WebKit   |
| ----------------------------------------------------------------- | -------- | -------- | -------- |
| Pages that loaded                                                 | 29 of 29 | 29 of 29 | 25 of 29 |
| Third-party hosts the browser reached that the guard did not list | 0        | 0        | 0        |
| Cookies the browser held that the guard did not list              | 0        | 0        | 0        |
| Storage keys the browser held that the guard did not list         | 0        | 0        | 0        |
| Pages without any finding in the core rules                       | 4        | 4        | 4        |
| Distinct other hosts in the findings                              | 130      | 143      | 86       |
| Pages with a cookie finding                                       | 14       | 13       | 9        |

What this says:

- **The guard does not miss what the browser does.** In 83 loads, nothing the browser did on the network, in its cookies or in `localStorage` and `sessionStorage` was missing from the report. Four WebKit loads failed before there was anything to compare (three timeouts of 45 seconds and a certificate error on CNN, which are the browser and the network of the test machine, not the guard).
- **It lists more than the browser's own record, for known reasons.** The guard also counts `<link rel="preconnect">` and `dns-prefetch` (the browser opens a connection to a third party because the page asked it to), cookies that a script sets and removes again (feature tests such as `_cookie_test`, `dd_testcookie`, `TESTCOOKIESENABLED` on bbc.com, nytimes.com and cnn.com, which are gone when the page is done but did happen) and storage that is not `localStorage` (IndexedDB, Cache Storage, service workers).
- **The four pages without a finding** are plausible.io, signal.org, rust-lang.org and svelte.dev. Hacker News has one: its search box sends to Algolia. gnu.org has two: its own subdomain `static.gnu.org` and a sign-up form at the Free Software Foundation. Wikipedia loads from its sister domain `wikimedia.org`, sets cookies and stores things in the browser. A form to another origin is an error by default (what the visitor types leaves the site), and a site that means it allows it with a reason.
- **The news sites show what the rules are for.** bbc.com asks 17 other origins for something (and tells the browser about 9 more), cnn.com 30, and the pages list 20 and 18 cookies. nytimes.com in Firefox filled the storage with 803 probe keys (see below). Hosts are named with their company and category where the dataset knows them (69 of the 130 hosts in Chromium: analytics, advertising, tag manager, consent provider); the rest are mostly the sites' own other domains.
- **The browsers differ where the browsers differ.** Firefox reaches more hosts than Chromium on the same pages (143 against 130 in total; ad auctions change from load to load). WebKit keeps fewer cookies (9 pages with a cookie finding against 14 in Chromium), and the guard reports a cookie that a script set even when the browser did not keep it (`__cf_bm` on bbc.com in WebKit).
- **Header and policy advice is common and loud.** 27 of 29 pages have at least one header finding (a missing `Referrer-Policy` on 26, no policy at all on 17), and 12 pages have a weak policy (`unsafe-inline` on 6, `unsafe-eval` on 5). That is why these rules are warnings and off until you ask for them.

## What the first version got wrong

Each point is now fixed, with a test:

1. **A site's own service worker was a third party.** The request for `sw.js` of playwright.dev and web.dev, and everything a service worker fetches, belongs to no page (Playwright gives it no frame), so the guard judged it against an empty address, and the site's own file was reported as "1 request to playwright.dev". Without a `baseURL` (a script, or a test that builds its own context) a request without a page is judged against the page that was opened last. What the service worker imports from elsewhere (`workbox-sw.js` from `storage.googleapis.com`) is still found.
2. **A page that probes the storage with a new key every time was 805 findings in Firefox.** nytimes.com writes `nyt-test-1793221869894` to the storage again and again (a test whether storage works). Keys that differ only in a number of six digits or more are now one finding, `localStorage "nyt-test-*"`, with the number of keys, an example and the pattern that allows all of them. An allow entry has to match every key of the group, not only one.
3. **Firefox ended media requests with an error.** `NS_ERROR_PARSED_DATA_CACHED` is how Firefox closes a video request whose data it already has (four "failed requests" on nytimes.com, one on gnu.org). It is not a failure.
4. **A hint for the most common alarm.** On 10 of the 29 pages one of the "other origins" is a subdomain of the site itself (`static.gnu.org`, `analytics.python.org`, `sponsors.vite.dev`, `ophan.theguardian.com`). A subdomain is another origin, and that is correct by default, but it is often meant. (A related domain such as `bbci.co.uk` for bbc.com, or `wikimedia.org` for wikipedia.org, cannot be told from a stranger by its name and stays a finding.) The finding now says "same website as the page: to allow all of it, `firstParty: ['gnu.org', '*.gnu.org']`".

## What stays as it is, and why

- **A form to another origin is an error**, even when nobody submitted it. It is the one rule where seven of 29 pages (a quarter) have a finding for something that is meant (search, donation, newsletter). The finding names the form and the target and a project allows it with a reason. Lowering it to a warning would hide the case this rule exists for: a login form that posts to a third party.
- **Failed requests, console errors and HTTP errors of the pages are reported as they are.** the policy of go.dev blocks its own analytics requests, `eval` and an inline script (five violations), nextjs.org answers a 401 on `/api/get-session`, bbc.com throws two React errors, nytimes.com answers 403 to a headless browser. They are real, and a test of your own page would want to know.
- **Cookies that a script sets and removes are listed.** They show that the page probes for cookies, which is information. A site that means it allows the name.
- **Pages that fail to load in WebKit** (timeouts, a certificate error) are the machine and the network.

## Pages with the most to say

Chromium, the number of findings of a rule on the page (the browser's own count of other origins and cookies next to it).

| Page                          | Other hosts | Reached by a request | Cookies | Storage entries | Errors | Policy violations |
| ----------------------------- | ----------- | -------------------- | ------- | --------------- | ------ | ----------------- |
| bbc.com/news                  | 26          | 17                   | 20      | 26              | 2      | 0                 |
| edition.cnn.com               | 37          | 30                   | 18      | 19              | 9      | 0                 |
| theguardian.com/international | 11          | 6                    | 7       | 5               | 0      | 0                 |
| web.dev/articles/cls          | 11          | 10                   | 3       | 7               | 0      | 0                 |
| nytimes.com                   | 4           | 4                    | 7       | 1               | 1      | 0                 |
| go.dev/doc                    | 6           | 6                    | 6       | 1               | 1      | 5                 |
| spiegel.de                    | 5           | 5                    | 5       | 6               | 0      | 0                 |

"Other hosts" are the findings of the rule; hosts that only appear in a `preconnect` or `dns-prefetch` hint are in it, and "reached by a request" is what the browser's own record shows. Cookies and storage entries are findings of the guard, which also counts IndexedDB, Cache Storage and service workers.
