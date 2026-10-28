---
'playwright-privacy-guard': patch
---

Four fixes from a trial on 29 public pages in three browsers ([docs/survey.md](docs/survey.md)):

- **A site's own service worker is not a third party.** A request that belongs to no page (the `sw.js` of the site, or what a service worker fetches) was judged against an empty address when there is no `baseURL`, so the site's own file was reported. It is judged against the page that was opened last now. What the service worker imports from another origin is still found.
- **A storage probe is one finding.** A page that writes a new key every time to see whether the storage works (`nyt-test-1793221869894`, 803 keys on one page in Firefox) is one finding, `localStorage "nyt-test-*"`, with the number of keys and the pattern that allows all of them. Keys that differ in a number of six digits or more are grouped; an allow entry has to match every key.
- **Firefox's end of a media request is not a failed request.** `NS_ERROR_PARSED_DATA_CACHED` is ignored like an aborted request.
- **A subdomain of the page's own website says how to allow it.** The finding of a request to `static.example.com` from `www.example.com` now ends with `firstParty: ['example.com', '*.example.com']`. It is still another origin, and still a finding.
