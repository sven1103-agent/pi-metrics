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

## What a supply-chain scan sees

A scanner that reads this **repository** will flag packages, not this extension. Socket, for
example, reports `shellAccess` against a number of them. `child_process` appears zero times in
`extensions/pi-metrics.ts` — the flags are on the tree around it.

They all arrive through `@earendil-works/*`, the Pi packages this repository installs to
typecheck and test against: `@earendil-works/pi-coding-agent` most heavily, and transitively
`cross-spawn`, `marked`, the OpenAI, Anthropic and Google SDKs, and their AWS and GCP credential
dependencies. A coding agent runs tools, so its own packages spawn processes. That is the
product — and a scanner cannot tell it apart from a package that spawns processes for reasons
you would not want. Reporting the capability is the correct behaviour for the scanner, and
nothing here is worth changing.

Two properties keep all of it off anyone's machine:

- **Every one of those packages is `dev` in the lockfile**, so none is a runtime dependency.
- **A consumer installs none of it.** `package.json` declares no `dependencies`, and Pi supplies
the three host packages in `peerDependencies`. Installing `pi-metrics` adds no third-party code,
so a scan of the *published* package has nothing of this to report at all.

To re-derive it rather than take this on trust: `npm why <package>` for any name a scanner gives
you, or read the `dev` flag on it in `package-lock.json`.

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
