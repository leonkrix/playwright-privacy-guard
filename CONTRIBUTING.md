# Contributing

Thank you for looking at this. Bug reports, false positives and ideas are as welcome as code.

## How a change gets in

1. **Issue first, for anything bigger than a small fix.** A bug with a reproduction, an idea for a rule or an option: open an [issue](https://github.com/leonkrix/playwright-privacy-guard/issues) and say what you want to protect. It saves you from writing code that does not fit.
2. **Small fixes and documentation: straight to a pull request.** A typo, a wrong sentence in the README, a clear bug with a test.
3. **Fork, branch, pull request.** Fork the repository, make a branch, and open a pull request against `main`. You do not need write access, and nobody has to add you.
4. **The CI runs.** The first time you contribute, a maintainer has to approve the run (GitHub asks for that for every new contributor, because workflows run code). The check `CI passed` has to be green.
5. **The maintainer reviews and merges.** Only a maintainer can merge. Pull requests are squash-merged, so the title of the pull request becomes the commit message: write it as a Conventional Commit.
6. **The change is released** with the next version. A pull request that users can see carries a changeset (see below); the maintainer collects them into a release.

Nobody merges their own pull request without the CI. While there is one maintainer, the maintainer's own pull requests need no second approval; that changes as soon as there is a second maintainer.

## Reporting a false positive (or a miss)

The most useful report is a page where the guard fails a test although the page does nothing wrong, or stays silent although it leaks. Please include:

- the message of the failed test (it names the rule, the host, cookie or key),
- the HTML (and the script, and the response headers if they matter) that reproduce it, as small as you can make it,
- the browser and the versions of Playwright and this package.

A small page for `test/fixtures/` that shows the problem, with a test, is the best report there is.

## Development

You need Node 24 (see `.nvmrc`) and [pnpm](https://pnpm.io) (the version is pinned in `package.json`, Corepack picks it up: `corepack enable`).

```bash
pnpm install
pnpm exec playwright install chromium   # firefox and webkit are optional, see below
pnpm check                              # lint, format, types, unit tests, build, package lint, browser tests
```

- `pnpm test` runs the browser tests in Chromium. `pnpm test:all-browsers` also runs Firefox and WebKit (install them first with `pnpm exec playwright install firefox webkit`). The CI runs all three.
- `pnpm test:unit` runs the unit tests (Vitest): everything that needs no browser.
- `pnpm trackers` makes `src/trackers-data.ts` again from the `third-party-web` dependency. Run it when you update that dependency, and commit the result.

### How the code is organised

- **Watching** (needs a browser): `src/page-script.ts` runs in the page. Playwright sends it to the browser as text, so it has to be **self-contained**: no imports of values, no helpers from other files, no variables from outside the function. `src/install.ts` connects it to a browser context and collects the events of Playwright, `src/snapshot.ts` reads cookies and storage, `src/fixture.ts` is the `test` with the guard switched on.
- **Judging** (pure, no browser): `src/rules.ts` has one function per rule, `src/evaluate.ts` runs them, `src/context.ts` answers "is this your own?" and "what is allowed at this moment?". The helpers are small and tested alone: `match.ts` (hosts and names), `stack.ts`, `csp.ts`, `headers.ts`, `trackers.ts`.
- **Showing**: `src/format.ts` (the message), `src/report-html.ts`, `src/aggregate.ts` and `src/reporter.ts` (the page for the whole run), `src/baseline.ts`.
- Every rule has a small page in `test/fixtures/` and a test next to the others in `test/*.spec.ts`. A change in what counts as a finding starts with such a page. A rule that is only logic (a header check, a policy check) gets a unit test next to its file.
- The test server (`test/server.mjs`) listens on two ports: `127.0.0.1:4410` is "the site", `localhost:4411` is "another origin", and some routes answer with headers and cookies on purpose.

### Pull requests

- One topic per pull request. Add or change a test.
- Add a changeset for anything users can see: `pnpm changeset` (choose patch, minor or major and write one sentence). Documentation and CI changes do not need one.
- The pull request title is a [Conventional Commit](https://www.conventionalcommits.org) (`fix: ...`, `feat: ...`, `docs: ...`, `chore: ...`).
- The check `CI passed` has to be green.

By contributing you agree that your contribution is licensed under the MIT license of this project.
