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

## Signing and notarization

Unsigned builds are suitable for testing but create trust warnings. A public release should eventually configure:

- Windows Authenticode certificate and Electron Builder signing variables
- Apple Developer ID Application certificate
- Apple notarization credentials or App Store Connect API key
- Protected GitHub environments for signing secrets

Never commit certificates, passwords, or base64-encoded signing material.

## Release checklist

- Run `npm ci`, `npm audit`, `npm run build`, and `npm run dist:dir`.
- Run `npm run dist:test`, install **Neuron Test**, and test the demo repository locally.
- Confirm version numbers and release notes.
- Run `npm run release` only when the build is ready to publish as production.
- Push the tag and watch every matrix job.
- Download-test each artifact from GitHub Releases.
- Check the Pages download button.
- Publish checksums or build provenance when the signing pipeline is introduced.
