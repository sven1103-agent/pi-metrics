# Security

## Scope of this extension

Pi extensions run inside the Pi process with the same operating-system permissions as
Pi itself. Pi has no built-in sandbox. Anything a Pi extension can read or run, it can
read or run — so it is fair to ask what this one actually does.

`pi-metrics` is a display extension. It observes the provider traffic Pi already
handles and renders latency figures in the terminal. Verified against the source:

- **No network calls.** No `fetch`, no HTTP client, no sockets.
- **No credential access.** It never reads `auth.json`, environment API keys or any
  other secret.
- **No process execution.** No `child_process`, no `spawn`, no shell.
- **One optional file write.** If `PI_METRICS_TRACE` is set to a path, the extension
  appends ticker/render diagnostics to that file via `appendFileSync`. If the variable
  is unset — the default — nothing is written anywhere.
- **No telemetry.** No usage, session content or metrics leave the machine.
- **No dependencies of its own.** `package.json` declares no runtime `dependencies`, so
  installing this package pulls in no third-party code at all. The three
  `peerDependencies` are Pi's own packages, present already. `npm audit` therefore has no
  dependency tree to report on for this package, and advisories can only ever come from
  the build and test tooling, not from what you install.

Session metrics live in memory only. The optional `persist` setting writes a one-line
summary card into the Pi transcript, which is Pi's own session file.

## Reporting a vulnerability

Open a [private security advisory](https://github.com/sven1103-agent/pi-metrics/security/advisories/new).
That channel is private to you and the maintainer, and it is the one to use — please do not
open a public issue for anything exploitable.

The npm registry also carries the maintainer address if you would rather send mail than use
GitHub — `npm view @sven1103-agent/pi-metrics maintainers` prints it. The npm package *page*
shows the maintainer's username only, so the command is the way to get the address.

Expect an acknowledgement within a few days. This is a small, single-maintainer
project; there is no formal SLA.

## Supported versions

Security fixes target the latest release. Older versions are not backported.

Before `1.0.0` the project is in initial development and versions move quickly, so in practice
that means the newest `0.x` only. `1.0.0` is the first release with a compatibility promise; the
support policy for older stable releases will be written then.
