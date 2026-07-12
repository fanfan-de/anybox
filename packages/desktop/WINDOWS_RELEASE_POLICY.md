# Windows release policy

Anybox is currently distributed as a free, open-source project by an individual publisher.

## Authenticode

Authenticode signing is optional for the current Windows release channel. A missing Windows
code-signing certificate must not block an otherwise verified public release. If valid signing
credentials are available, the installer should still be signed.

Unsigned Windows releases must:

1. be built from the exact commit referenced by the release tag;
2. pass the normal version, test, typecheck, media-runtime, packaging, and installed-app checks;
3. publish the installer, blockmap, and matching `latest.yml` as one immutable artifact set;
4. publish and verify the installer's SHA-256 digest;
5. state clearly in the release notes that the installer is unsigned and Windows SmartScreen may
   display an unknown-publisher warning; and
6. use the same installer bytes on GitHub and the Tencent COS/CDN mirror.

Signing is a trust and user-experience improvement, not a release-readiness requirement under this
temporary policy. This exception applies only to Windows Authenticode. It does not relax media
licensing, artifact-integrity, updater-metadata, installed-app recovery, or macOS signing and
notarization requirements.
