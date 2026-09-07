# Security policy

## Supported versions

This project is preparing its first npm release. Security fixes are developed on `main`; after publication, use the latest release. There is no commitment to backport fixes to older prerelease versions.

## Report a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/laststance/happy-dom-extended/security/advisories/new) to contact the maintainers without publishing exploit details. Include affected versions, a minimal reproduction, impact, and any proposed mitigation. Do not put secrets or private application data in reports.

If the private reporting form is unavailable, use the contact options on the [maintainer's GitHub profile](https://github.com/ryota-murakami) to arrange a private report. Do not open a public issue containing an unpatched exploit.

## Runtime model

This package runs test code inside Node.js and uses native Canvas libraries. It is not a security sandbox for untrusted JavaScript, images, URLs, or HTML. Happy DOM image loading is enabled by default; disable it explicitly when the test should not load image files. Restrict inputs and network access at the runner or operating-system boundary as appropriate for your application.

CI uses CodeQL, dependency review, a production dependency audit, Socket dependency scanning, and OpenSSF Scorecard. Socket requires a configured API token and skips fork PRs; see [CI setup](README.md#contribute). These checks help identify problems; they do not establish that the project is vulnerability-free. Keep native dependencies, Node.js, and the package manager updated.
