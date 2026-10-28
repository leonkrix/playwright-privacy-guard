# Security policy

## Supported versions

The latest released version gets security fixes. While the version is `0.x`, older minor versions do not.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private vulnerability reporting: on the repository page choose **Security**, then **Report a vulnerability**. You get an answer within a few days.

## What this package does

The package runs inside your tests. It watches the page that a test opens: the requests it makes, the cookies and storage it writes, the policy violations and errors it reports, and the headers it receives. It attaches what it found to the test result. It never sends anything over the network, has no runtime dependencies, and does not store anything of its own.

A small script is added to the page in the test browser to see storage writes, policy violations and the use of sensitive browser APIs. It is meant for test environments, not for production pages. A report can contain the addresses, cookie names and keys of the page under test: treat the attachments of a test run like the logs of your site (the option `redact` removes the query strings and values).

The releases on npm are published from GitHub Actions with provenance, so each version can be traced back to the commit and the workflow run that built it.
