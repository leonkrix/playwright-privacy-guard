---
'playwright-privacy-guard': minor
---

The report now lists what was allowed on purpose: every allow entry that let something pass, with how often and the reason you gave, in the text and HTML report of a test and in the table of the whole run (the reporter). `apis` and `fingerprint` entries can carry a reason too (`{ match: 'canvas', reason: '...' }`). New rule `cookieAttributes` (off until asked for) that asks the cookies you allowed to be `Secure`, `HttpOnly` (by name), not set with `SameSite=None` and not to live too long. A test that finds nothing but used an allow entry now attaches the JSON report, so that the reporter can list it.
