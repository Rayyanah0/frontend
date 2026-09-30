# Releasing the frontend

## Version and changelog

Use Conventional Commit pull request titles because the repository squash-merges
pull requests. Accepted types include `feat`, `fix`, `docs`, `refactor`,
`perf`, `build`, `ci`, and `chore`; use `feat!:` or a `BREAKING CHANGE:` footer
for a breaking change. The PR workflow runs Commitlint against the PR title.

On pushes to `main`, Release Please opens or updates a release PR. Merging that
PR updates `package.json`, `package-lock.json`, `.release-please-manifest.json`,
and `CHANGELOG.md`; it creates the version tag and GitHub Release. The tag
workflow builds one immutable image in GHCR and deploys that same image to
staging before queuing production.

## GitHub configuration

Set repository Actions variables used to validate the build:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_STELLAR_NETWORK` (`testnet` or `mainnet`)
- `NEXT_PUBLIC_STELLAR_TESTNET_CONTRACT_ID`
- `NEXT_PUBLIC_STELLAR_MAINNET_CONTRACT_ID`

Create GitHub environments named `staging` and `production`. Add the following
variables to each environment, using that environment's values:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_STELLAR_NETWORK`
- `NEXT_PUBLIC_STELLAR_TESTNET_CONTRACT_ID`
- `NEXT_PUBLIC_STELLAR_MAINNET_CONTRACT_ID`
- `APP_PORT` (optional; defaults to `3000`)

Add these environment secrets; the registry token must have `read:packages`:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `REGISTRY_USERNAME`
- `REGISTRY_TOKEN`

Both deployment hosts need Docker installed, inbound SSH access from GitHub
Actions, and the selected port open behind the appropriate reverse proxy. Set
`production` environment required reviewers in repository settings; the
workflow's production job is ordered after staging and waits for that approval.
The production frontend API/network values are deployment-time configuration,
not secrets. Do not put private keys or passphrases in `NEXT_PUBLIC_*` values.

## Rollback

From **Actions → Roll back production → Run workflow**, enter the last known-good
release tag (for example `v1.2.3`). Approve the protected `production`
environment. The workflow pulls the existing GHCR image and replaces the
current frontend container; it does not rebuild or change source. With the
image already published and host available, the redeploy is designed to finish
in under five minutes. Confirm the version and SHA in the in-app About panel
after the job completes.

## Dry run and release checklist

Before enabling production deployments, run the release workflow on a fork
with equivalent `staging` variables/secrets and attach the Actions logs to the
release PR. Confirm that the tag appears in GitHub Releases and GHCR, staging
reports the tag's SHA in About, and production waits for environment approval.
Then perform one rollback to a prior image tag and record the elapsed time.

Required production setup also includes environment reviewers and a host with
Docker/SSH configured. This repository checkout has no deployment credentials,
so it cannot produce a dry-run log or verify the external hosts by itself.
