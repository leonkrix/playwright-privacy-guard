---
'playwright-privacy-guard': minor
---

A command line: `npx playwright-privacy-guard scan <address...>` opens public or staging pages in a browser and reports what the guard finds, with no test to write. Addresses can come from a file (`--file`), the browser can be chosen (`--browser`), the report can be text, JSON, Markdown or HTML (`--format`, `--out`), the options of the guard come from a JSON file (`--options`), `--all-rules` also looks at headers, the policy, fingerprinting and cookie attributes, and the exit code is 0, 1 (found something at the level of `--fail-on`) or 2 (wrong command, or a page that could not be loaded). The script that made the [trial on public pages](docs/survey.md) is the first version of it.
