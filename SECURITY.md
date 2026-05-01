# Security Policy

## Reporting a vulnerability

If you discover a security issue in Fugazi, please report it privately through
GitHub Security Advisories on this repository:

> Settings → Security → Advisories → Report a vulnerability

Please do **not** open a public issue, pull request, or discussion thread
disclosing the problem until the maintainers have had a chance to investigate
and ship a fix.

When reporting, please include:

- A description of the issue and the impact you observed.
- Steps to reproduce, ideally a minimal repository or input that triggers the
  problem.
- The version of Fugazi (`fugazi --version`), the host runtime (Bun or Node)
  and version, and the operating system.

We will acknowledge your report within **5 business days** and aim to provide
a remediation plan within **15 business days**. Coordinated disclosure
timelines are negotiated case by case.

## Supported versions

Fugazi follows semver. Security fixes are issued on the latest minor of the
current major. Older majors receive critical fixes only at the maintainers'
discretion.

| Version range | Status      |
| ------------- | ----------- |
| `0.x`         | Pre-release |

## Scope

Security reports are welcomed for, but not limited to, the following:

- Code execution or sandbox escape via untrusted input (project files,
  configuration, plugins).
- Denial of service caused by analyzer input (parser, graph, duplicate
  detection).
- Path traversal or file read/write outside the analyzed project root.
- Tampering with cached artifacts that would cause the analyzer to produce
  incorrect output silently.
- Integrity weaknesses in WASM blob verification or any other supply-chain
  surface.

## Out of scope

- Findings that require physical access to a developer machine already running
  arbitrary user code.
- Reports based solely on outdated transitive dependencies without a working
  proof of concept against Fugazi.

## Acknowledgements

Researchers who report valid issues will be credited in the release notes for
the fix, unless they prefer to remain anonymous.
