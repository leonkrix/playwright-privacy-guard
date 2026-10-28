# playwright-privacy-guard

## 0.2.0

### Minor Changes

- ab3cc8d: A link that opens another website in a new tab is no longer a finding: the requests, cookies and storage of that tab are left out, because they are not the page's doing. A new tab on your own site is judged like any page. Font probing is also found in Chromium before 130, which has no global `FontFaceSet`. The reporter leaves out tests that are expected to fail (`test.fail()`) and has an `ignore` option for tests by title.

## 0.1.0

### Minor Changes

- 8ac8201: First release: a Playwright fixture that fails a test when the page talks to other origins, sets cookies, stores data on the device, breaks its Content Security Policy, uses sensitive browser APIs or logs errors. Names the host, the cookie or the script, allows with reasons, can check security headers and the quality of the policy, writes JSON and HTML reports and a reporter for the whole run, and has a baseline for projects that are not clean yet.
