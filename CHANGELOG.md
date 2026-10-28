# playwright-privacy-guard

## 0.1.0

### Minor Changes

- 8ac8201: First release: a Playwright fixture that fails a test when the page talks to other origins, sets cookies, stores data on the device, breaks its Content Security Policy, uses sensitive browser APIs or logs errors. Names the host, the cookie or the script, allows with reasons, can check security headers and the quality of the policy, writes JSON and HTML reports and a reporter for the whole run, and has a baseline for projects that are not clean yet.
