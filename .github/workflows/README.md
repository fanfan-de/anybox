# GitHub Actions policy

Anybox production releases are built, signed, verified, and published from locally controlled machines. GitHub is used only to host the repository and immutable GitHub Release assets.

Do not add an Actions workflow that builds, signs, approves, uploads, or promotes production release artifacts; those operations remain under local release authority.

Workflows that remain in this directory are non-release verification or technical-preview utilities. Their artifacts are not production release candidates and they must not publish to GitHub Releases, Tencent COS, or an updater channel.
