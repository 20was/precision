# Repository security and collaboration

These are the GitHub settings configured for the public `20was/precision` repository. The settings are intentionally limited to the workflows and collaboration this project currently uses.

## `main` branch

- Pull requests are required, including for administrators.
- The `quality` GitHub Actions check must pass against the latest base branch.
- All pull request conversations must be resolved.
- Linear history is required; the repository accepts squash merges only and deletes merged branches.
- Force pushes and branch deletion are blocked.
- Required approving reviews are set to zero while this is a solo-maintainer project. This keeps the PR and CI gate usable without inventing a reviewer. Revisit the review count when additional maintainers are available.

## Automated checks

- `CI` runs type checking, linting, unit tests, and production build on pushes to `main` and pull requests.
- `CodeQL` scans TypeScript/JavaScript on pushes, pull requests, and a weekly schedule.
- Dependabot checks npm dependencies and GitHub Actions weekly. Minor and patch npm updates are grouped to keep update PR volume manageable.
- Actions are restricted to GitHub-owned actions and must use full commit SHAs. The workflows currently use pinned versions of checkout, setup-node, and CodeQL.

## GitHub security features

- Dependabot vulnerability alerts and automated security fixes are enabled.
- Secret scanning and push protection are enabled.
- Private vulnerability reporting is enabled through GitHub's Security tab.
- The dependency graph is available for this public repository.

Non-provider secret patterns and secret validity checks are not enabled: GitHub documents them for organization-owned repositories with paid Secret Protection plans, not this user-owned repository. Project and Wiki tabs are disabled because the current source docs and pull requests cover those needs. Discussions and Issues are enabled for community support.

Recheck this file and the repository settings if the project moves to an organization, gains additional maintainers, or changes its release process.
