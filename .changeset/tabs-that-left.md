---
'playwright-privacy-guard': minor
---

A link that opens another website in a new tab is no longer a finding: the requests, cookies and storage of that tab are left out, because they are not the page's doing. A new tab on your own site is judged like any page. Font probing is also found in Chromium before 130, which has no global `FontFaceSet`. The reporter leaves out tests that are expected to fail (`test.fail()`) and has an `ignore` option for tests by title.
