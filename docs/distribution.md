# Distribution and releases

GitHub Pages cannot execute or install an Electron application. It hosts the public download page, while GitHub Releases stores the actual installers. Neuron's Pages button resolves the repository owner and name from the Pages URL and links to the newest release.

## First GitHub publication

1. Create an empty GitHub repository named `Neuron`.
2. Add the remote and push `main`.
3. In **Settings → Pages**, select **GitHub Actions** as the source.
4. Confirm Actions are enabled under **Settings → Actions → General**.
5. Enable private vulnerability reporting under **Settings → Security**.

```bash
git remote add origin https://github.com/YOUR_ACCOUNT/Neuron.git
git push -u origin main
```

The CI workflow validates pushes and pull requests. The Pages workflow deploys `docs/` after relevant changes to `main`.

## Publish a release

Create and install a local beta first:

```bash
npm run dist:test
```

This writes a **Neuron Test** installer under `release/test/`. It uses the same packaged runtime path as production while keeping a separate app id, installer name, and user data from the final app.

Update `package.json`, commit the version, and push a matching tag:

```bash
git tag v1.0.0
git push origin main --tags
```

`.github/workflows/release.yml` builds and uploads:

- Windows x64: NSIS and portable builds
- Linux x64: AppImage and Debian packages
- macOS: DMG and ZIP builds for x64 and arm64

The workflow uses the repository-provided `GITHUB_TOKEN`; no personal access token is required for normal release uploads.

## Signing, and what each kind of signing actually buys

It is worth separating three things that get called "signing", because they
solve different problems and only one of them is free.

### Proving a download is the build CI produced

This is the integrity question: did someone swap the installer between GitHub
and the user?

**A self-signed Authenticode certificate does not answer it.** It has no trust
anchor, so anyone who tampers with the installer can re-sign it with their own
certificate carrying the same subject name, and Windows presents the two
identically. It also does not remove the SmartScreen warning.

What does answer it, and costs nothing:

- **SHA-256 checksums** — `SHA256SUMS.txt` is attached to every release.
- **Build provenance** — the release workflow attests each installer with
  `actions/attest-build-provenance`, signed by GitHub's OIDC identity. The
  attestation names the exact workflow, commit and runner that produced the
  file, and cannot be forged by re-signing.

Anyone can verify a download:

```bash
gh attestation verify Neuron-0.4.3-win-x64.exe --repo neuron-workspace/Neuron
sha256sum -c SHA256SUMS.txt --ignore-missing
```

### Removing the "Unknown publisher" warning on direct downloads

Only an OV or EV certificate from a recognised CA does this, at roughly
$200-400 a year, and an OV certificate still needs to accumulate SmartScreen
reputation before the warning stops. Not currently purchased.

The pipeline is wired for it anyway: set the `WINDOWS_CERT_BASE64` and
`WINDOWS_CERT_PASSWORD` repository secrets and the release build signs. With no
secret set the build runs unchanged and produces unsigned installers, so this
never becomes a reason a release fails.

### Installing your own .appx before submitting it

Windows refuses to install an MSIX/APPX whose signature it cannot chain to a
trusted root, so a self-signed certificate is genuinely required here — you
cannot test your own Store package without one. **Partner Center re-signs the
package on submission**, so Store users never encounter it and never see a
SmartScreen warning.

```powershell
.\tools\make-signing-cert.ps1
```

The certificate subject must equal the appx `publisher` exactly, which is why
the script reads it from `package.json` rather than asking. `.pfx` and `.p12`
are gitignored; never commit key material or a base64 copy of it.

### macOS

Unsigned and un-notarized. macOS Gatekeeper blocks unsigned apps by default, so
mac users must right-click → Open on first launch. Fixing this needs an Apple
Developer account ($99/yr), a Developer ID Application certificate, and
notarization credentials. Not currently configured.

## Microsoft Store

**Published and live**, as of 8 September 2026:
<https://apps.microsoft.com/detail/9pfc0xc16c1g> — listed as *Neuron Desktop*.

This is now the best way to install on Windows, and the only channel where the
first launch is not an argument with the operating system. The Store package is
signed by Microsoft after certification, so SmartScreen has nothing to warn
about; updates come from the Store rather than the in-app updater, which
`updater.ts` already knows to stand down for (`windowsStore` → no update check,
so the two never fight over the same install).

The store identity stays on the personal account rather than the organisation —
see the table below. Moving the repository did not move the listing, and it
should not: the certificate and the Partner Center account are tied to it.

The Partner Center identity is filled in, and verified against a real build:

| Partner Center field | `build.appx` key | Value |
| --- | --- | --- |
| Package/Identity/Name | `identityName` | `ShivamKhetan.NeuronDesktop` |
| Package/Identity/Publisher | `publisher` | `CN=7632F1A5-...` |
| Package/Properties/PublisherDisplayName | `publisherDisplayName` | `Shivam Khetan` |

**None of these are secrets.** They are written into the manifest of every MSIX
that ships, so anyone who installs the app can read all three, and they appear
in the Store listing anyway. The certificate private key is the secret; the
identity is a public name.

Two ways to get the package:

- **From CI.** Tagging a release builds it and attaches it to the workflow run
  as the `neuron-store-appx` artifact. It is deliberately *not* attached to the
  GitHub release: it is unsigned by design, and only Partner Center can do
  anything with it.
- **Locally.** `npm run dist:store` writes it to `release/prod/`.

Then test-install it (see the signing section above), upload it in Partner
Center, and submit.

`package.json`'s `build` block is the single source of truth.
`tools/electron-builder.env.cjs` spreads it and overrides only the test/prod
differences. Both are live -- the release workflow reads `package.json`, the
`dist:*` scripts read the cjs file -- and while they were maintained separately
they drifted: the identity was filled in on one side and still a
`REPLACE.WITH...` placeholder on the other, and the appx built happily with
placeholders in its manifest. If you change packaging, change `package.json`.

The package version must be plain numeric (`0.4.3`), with no prerelease
suffix. This is why the version is `0.4.3` rather than `0.4.3-beta.1`; the
GitHub release can still be marked as a prerelease independently.

## Linux

Direct downloads (AppImage and `.deb`) are attached to every GitHub release by
the existing matrix. No signing is required for either.

**Flathub** is the distribution channel worth adding: it is where Linux users
look for applications, it handles updates and sandboxing, and it is free.

`flatpak/io.github.neuron_workspace.Neuron.metainfo.xml` holds the AppStream
metadata Flathub requires — the listing text, screenshots, release history and
content rating.

Two things are not done and cannot be finished from here:

- **The Flatpak manifest itself.** Building an Electron app in a Flatpak sandbox
  needs an offline npm cache generated by `flatpak-node-generator`, and the
  manifest has to be iterated against `flatpak-builder` on a Linux machine.
  Writing one without that build loop produces a file that looks right and does
  not build.
- **The app id.** Flathub requires an id under a domain you control. For a
  GitHub-hosted project that is `io.github.<owner>.<project>`, with hyphens
  in the owner written as underscores — `io.github.neuron_workspace.Neuron`. The
  current electron-builder `appId` is `io.github.neuron.notes`, which maps to no
  real GitHub account and would be rejected. The Flatpak id can differ from the
  electron-builder `appId` without changing Windows or macOS behaviour, which is
  the lower-risk option; changing `appId` itself affects the Windows
  AppUserModelID and the upgrade path for existing installs.

Submission, once the manifest builds: fork `flathub/flathub`, add a branch named
for the app id containing the manifest and metainfo, and open a pull request.
Review is manual and typically takes days to weeks.

## In-app updates

electron-builder already writes `latest.yml`, `latest-mac.yml` and
`latest-linux.yml` beside the installers on every release, each carrying a
sha512 for every artifact. **That file is the security boundary.** It is fetched
from GitHub over HTTPS, and electron-updater refuses to install a download whose
hash does not match it. None of that depends on the binary being code-signed,
which matters because these builds are not.

`src/main/updater.ts` decides whether to check and what counts as an update.
The rules, and why each exists:

| Situation | Checks? | Why |
|---|---|---|
| Packaged Windows or Linux | yes | The hash in `latest.yml` is the integrity check, signed or not |
| Development build | no | Nothing to update |
| Microsoft Store build | no | The Store updates it |
| macOS, ad-hoc signed | **no** | Squirrel.Mac will not install into an app it cannot validate; checking would download an update, fail at install, and repeat every launch |
| macOS, Developer ID | yes | Validation succeeds |
| Running a prerelease | accepts prereleases | Otherwise a beta user is told they are up to date forever — the only newer versions are betas, and the updater skips those by default |
| Running a stable build | stable only | A stable user did not opt into betas |

Two things that must not be "fixed" later without understanding them:
`verifyUpdateCodeSignature` is never disabled, and the feed URL is never set in
code. The first would make unsigned builds work by removing a check rather than
by not needing one; the second is how an update channel quietly stops being the
one that was built and tested. `tools/updater.test.mjs` asserts both, so a
future edit that reaches for either fails the suite.

When a Windows certificate does arrive, it becomes an *additional* check —
electron-updater compares the publisher name on the downloaded installer against
the running one. Nothing here has to change to enable it.

## Package managers

`.github/workflows/package-managers.yml` publishes to WinGet, Chocolatey and
Homebrew when the release build finishes. It is a separate workflow from
`release.yml` on purpose: nothing in it rebuilds anything. Every package points
at the artifacts `release.yml` already published, with the checksums of those
exact files, so a package can never describe a build that was not released.
The Windows manifest declares `Scope: user` because the one-click NSIS installer
is fixed to the current user's profile and never requests elevation.

**Prereleases do not publish.** Package managers are where people who opted into
nothing install from. Everything before 0.4.5 was a prerelease, so this gate is
hit more often than not.

### Where each one stands

Checked 5 September 2026, against 0.4.5.

| | Status | What a user runs |
|---|---|---|
| Microsoft Store | **Live.** Certified and signed by Microsoft, so no SmartScreen prompt; updates come from the Store. | [apps.microsoft.com/detail/9pfc0xc16c1g](https://apps.microsoft.com/detail/9pfc0xc16c1g) |
| Homebrew | **Live.** `Casks/neuron.rb` is on the tap at 0.4.5. | `brew install --cask neuron-workspace/neuron/neuron` |
| Chocolatey | **Submitted, awaiting a human moderator.** All three automated checks (validation, verification, virus scan) pass. | `choco install neuron` — see the caveat below |
| WinGet | **Not submitted.** `NeuronWorkspace.Neuron` does not exist in `microsoft/winget-pkgs` yet, and the action cannot create it. | nothing yet |

Homebrew matters more on macOS than the table makes it look. `updater.ts` turns
in-app updates off entirely on darwin without a Developer ID signature, because
Squirrel.Mac would download every update, fail at the install step, and do it
again on the next launch. So `brew upgrade` is not a convenience there — it is
the only way a macOS install ever moves to a new version. The cask deliberately
does *not* declare `auto_updates true`, and that is correct: the app genuinely
does not update itself on that platform.

Windows is the other way round: a Chocolatey install self-updates, so the
version Chocolatey has recorded drifts behind the installed one until the next
`choco upgrade`. That is the normal situation for a self-updating app in a
package manager and nothing here tries to prevent it.

The Chocolatey caveat is worth knowing before pointing anyone at it: an
unapproved package is excluded from the package feed, so a bare
`choco install neuron` cannot resolve it, while
`choco install neuron --version 0.4.5` downloads fine because that addresses the
version directly. Both become equivalent the moment a moderator approves it.
Nothing to do but wait; the site already carries the plain command.

The published cask still names `https://neuron-workspace.github.io/Neuron/` as
its homepage, which is now the redirect stub rather than the site. The generator
was corrected in the organisation move, after 0.4.5 was cut, so the next release
rewrites it — do not hand-edit the tap for this.

**It is triggered by `workflow_run`, not `release: published`.** The obvious
trigger does not work and does not say so: `release.yml` creates the release
using `GITHUB_TOKEN`, and GitHub refuses to start workflow runs from events a
`GITHUB_TOKEN` caused -- the rule that stops a workflow triggering itself for
ever. The event fires, no run starts, and nothing appears in any log. 0.4.5
published to GitHub with this workflow having never run once. `tools/publish-gate.test.mjs`
asserts the trigger for that reason, including that `release:` is *absent*.

The tag reaches the workflow only as `github.event.workflow_run.head_branch`,
which on a tag push is the tag name. `github.ref` is the default branch here,
because that is the ref a `workflow_run` workflow runs from.

Every step is idempotent, and the workflow can be re-run by hand
(`workflow_dispatch` with a tag) after fixing a token — WinGet's action is a
no-op when the version already exists, Chocolatey treats "already exists" as
success, and the Homebrew step exits quietly when the cask already says that
version.

### What you have to set up by hand

Nothing below is created automatically, and each publisher is skipped with a log
line rather than failing the run when its secret is absent — so you can enable
them one at a time.

| Secret | Where it comes from | What to do |
|---|---|---|
| `WINGET_TOKEN` | A GitHub **classic** PAT with `public_repo` | Fork `microsoft/winget-pkgs` to your account first, and submit version 1 by hand (below) — the action can only update a package that already exists. It then pushes a branch to your fork and opens a pull request against Microsoft's repo. A fine-grained token will not work — the action needs to push to a fork it did not create. |
| `CHOCO_API_KEY` | community.chocolatey.org → your account → API Keys | Register the `neuron` package id once by pushing manually, or the first automated push will be rejected. Chocolatey moderates new packages; expect the first version to sit in review. |
| `HOMEBREW_TAP_TOKEN` | A GitHub PAT with `contents: write` on the tap repo | `neuron-workspace/homebrew-neuron` already exists -- the name is not a choice, `brew tap neuron-workspace/neuron` resolves to it. The workflow clones it, writes `Casks/neuron.rb` and pushes. Users then `brew tap neuron-workspace/neuron && brew install --cask neuron`. |

No account is needed for any of this to keep working as it does today: with none
of the three secrets set, the workflow runs, logs three skips, and the GitHub
release is unaffected.

### The first WinGet submission has to be manual

`winget-releaser` uses [Komac](https://github.com/russellbanks/Komac) to build the
next version's manifest **from the previous one**, so it cannot create a package
that is not in `microsoft/winget-pkgs` yet:

> At least one version of your package should already be present in the Windows
> Package Manager Community Repository.

Same shape as Chocolatey, and it fails rather than skipping if you set the token
before doing this. The `manifests` job already writes exactly what the first
submission needs:

1. Run the workflow (`workflow_dispatch` with the tag) and download the
   `package-manifests` artifact, or generate it locally as described below.
2. Fork and clone `microsoft/winget-pkgs`.
3. Copy the three files from `winget/` into
   `manifests/n/NeuronWorkspace/Neuron/<version>/`.
4. Validate and test them:

   ```
   winget validate --manifest manifests/n/NeuronWorkspace/Neuron/<version>
   winget install --manifest manifests/n/NeuronWorkspace/Neuron/<version>
   ```

   (`winget settings --enable LocalManifestFiles` first, from an admin shell.)
5. Open the pull request. The first one is reviewed by a person; expect comments.

After that version is merged, every later release is handled by the workflow, and
the generated `winget/` manifests become a reference copy rather than the thing
that gets submitted.

### Regenerating the manifests by hand

`node tools/release-manifests.mjs v0.4.5 --out release/manifests` downloads the
published installers, hashes them, and writes the WinGet manifests, the
Chocolatey package and the Homebrew cask. Useful for inspecting exactly what
would be published, and for the first Chocolatey submission, which has to be
done manually anyway.

## Testing that a build actually runs

0.4.3 shipped an application that could not start, with all 47 end-to-end tests
green. They run against `dist/main/main.js` with the full `node_modules` tree
present; the packaged app loads from inside `app.asar`, which holds only what
electron-builder can reach from `dependencies`. `zod` is a peer dependency of
the AI SDK, npm hoists peers to the root, so it resolved everywhere except in
the thing users download.

Three layers now, cheapest first. Each catches something the one above it
cannot:

| Layer | Command | Catches | Cost |
| --- | --- | --- | --- |
| Static | `npm test` (`test:deps`) | A main-process import or required peer that is not declared | milliseconds |
| Packaged | `npm run smoke` | What only appears once packaged: native modules, `asarUnpack`, path assumptions | ~2 min |
| Clean machine | `tools/clean-room.wsb` | Missing OS runtimes, installer behaviour, first run on a profile that has never seen the app | manual |

CI runs typecheck, the unit suites, the build, the Playwright end-to-end suite
and the packaged smoke test on **Windows, macOS and Linux**. One platform is not
cross-platform testing: node-pty, the filesystem watcher, spawned processes,
keyboard chords and path handling all diverge between them.

The release workflow runs the packaged smoke test on all three **before**
publishing, so a build that cannot start never reaches a release.

Electron needs a display server, which the Linux runner does not have, so both
the end-to-end suite and the smoke test are wrapped in `xvfb-run` there. Left
unwrapped they fail as an unexplained Electron crash rather than as a missing
display.

**On Docker:** not the right tool here. Windows containers have no interactive
desktop, so a GUI installer cannot be driven or observed, and Linux containers
cannot run a Windows `.exe`. Windows Sandbox is free, built into Windows 11 Pro
and Enterprise, boots in seconds, and is destroyed on close. For Linux and
macOS, every CI run is already a clean machine -- which is what a VM would have
provided.

## Release checklist

- Run `npm ci`, `npm audit`, `npm run build`, and `npm run dist:dir`.
- Run `npm run dist:test`, install **Neuron Test**, and test the demo repository locally.
- Confirm version numbers and release notes.
- Run `npm run release` only when the build is ready to publish as production.
- Push the tag and watch every matrix job.
- Download-test each artifact from GitHub Releases.
- Check the Pages download button.
- Publish checksums or build provenance when the signing pipeline is introduced.
