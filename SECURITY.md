# Security policy

## Supported versions

This project is preparing its first npm release. Security fixes are developed on `main`; after publication, use the latest release. There is no commitment to backport fixes to older prerelease versions.

## Report a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/laststance/happy-dom-extended/security/advisories/new) to contact the maintainers without publishing exploit details. Include affected versions, a minimal reproduction, impact, and any proposed mitigation. Do not put secrets or private application data in reports.

If the private reporting form is unavailable, use the contact options on the [maintainer's GitHub profile](https://github.com/ryota-murakami) to arrange a private report. Do not open a public issue containing an unpatched exploit.

## Runtime model

This package runs test code inside Node.js and uses native Canvas libraries. It is not a security sandbox for untrusted JavaScript, images, URLs, or HTML. Happy DOM image loading is enabled by default; disable it explicitly when the test should not load image files. Restrict inputs and network access at the runner or operating-system boundary as appropriate for your application.

CI uses CodeQL, dependency review, a production dependency audit, Socket dependency scanning, and OpenSSF Scorecard. Socket requires a configured API token and skips fork PRs; see [CI setup](README.md#contribute-and-release). These checks help identify problems; they do not establish that the project is vulnerability-free. Keep native dependencies, Node.js, and the package manager updated.

The OpenSSF Scorecard report lists seven checks below a full score, and three of them are deliberate. Scorecard reports the Release workflow's checkout of the Test run's commit as an untrusted code checkout; that job runs only after a successful Test on a push to `main`, and the step straight after checkout stops the run unless that commit is still `origin/main`, before any repository code executes. Scorecard reports the Test workflow's global npm install as unpinned; the npm CLI installs a global package by version and offers no integrity option, while every remote action reference and the package manager itself are pinned by digest. Scorecard reports no dependency update tool; runtime dependencies are pinned to the exact versions the verification evidence covers, so an automatic bump would replace that evidence without re-running it, and [TODOS.md](TODOS.md) tracks that decision. The remaining four are open rather than deliberate: the repository's age, which clears itself once the repository is ninety days old; the single organization contributing to it; a best-practices badge; and a branch ruleset that requires status checks but neither a pull request nor a block on force pushes. [TODOS.md](TODOS.md) tracks the ruleset.
