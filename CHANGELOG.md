# playwright-privacy-guard

## 0.4.0

### Minor Changes

- 580edde: A command line: `npx playwright-privacy-guard scan <address...>` opens public or staging pages in a browser and reports what the guard finds, with no test to write. Addresses can come from a file (`--file`), the browser can be chosen (`--browser`), the report can be text, JSON, Markdown or HTML (`--format`, `--out`), the options of the guard come from a JSON file (`--options`), `--all-rules` also looks at headers, the policy, fingerprinting and cookie attributes, and the exit code is 0, 1 (found something at the level of `--fail-on`) or 2 (wrong command, or a page that could not be loaded). The script that made the [trial on public pages](docs/survey.md) is the first version of it.

## 0.3.1

### Patch Changes

- 47454ae: Four fixes from a trial on 29 public pages in three browsers ([docs/survey.md](docs/survey.md)):
  
  - **A site's own service worker is not a third party.** A request that belongs to no page (the `sw.js` of the site, or what a service worker fetches) was judged against an empty address when there is no `baseURL`, so the site's own file was reported. It is judged against the page that was opened last now. What the service worker imports from another origin is still found.
  - **A storage probe is one finding.** A page that writes a new key every time to see whether the storage works (`nyt-test-1793221869894`, 803 keys on one page in Firefox) is one finding, `localStorage "nyt-test-*"`, with the number of keys and the pattern that allows all of them. Keys that differ in a number of six digits or more are grouped; an allow entry has to match every key.
  - **Firefox's end of a media request is not a failed request.** `NS_ERROR_PARSED_DATA_CACHED` is ignored like an aborted request.
  - **A subdomain of the page's own website says how to allow it.** The finding of a request to `static.example.com` from `www.example.com` now ends with `firstParty: ['example.com', '*.example.com']`. It is still another origin, and still a finding.

## 0.3.0

### Minor Changes

- 583712e: The report now lists what was allowed on purpose: every allow entry that let something pass, with how often and the reason you gave, in the text and HTML report of a test and in the table of the whole run (the reporter). `apis` and `fingerprint` entries can carry a reason too (`{ match: 'canvas', reason: '...' }`). New rule `cookieAttributes` (off until asked for) that asks the cookies you allowed to be `Secure`, `HttpOnly` (by name), not set with `SameSite=None` and not to live too long. A test that finds nothing but used an allow entry now attaches the JSON report, so that the reporter can list it.

## 0.2.0

### Minor Changes

- ab3cc8d: A link that opens another website in a new tab is no longer a finding: the requests, cookies and storage of that tab are left out, because they are not the page's doing. A new tab on your own site is judged like any page. Font probing is also found in Chromium before 130, which has no global `FontFaceSet`. The reporter leaves out tests that are expected to fail (`test.fail()`) and has an `ignore` option for tests by title.

## 0.1.0

### Minor Changes

- 8ac8201: First release: a Playwright fixture that fails a test when the page talks to other origins, sets cookies, stores data on the device, breaks its Content Security Policy, uses sensitive browser APIs or logs errors. Names the host, the cookie or the script, allows with reasons, can check security headers and the quality of the policy, writes JSON and HTML reports and a reporter for the whole run, and has a baseline for projects that are not clean yet.
