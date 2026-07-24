# Mobile update public certificate

`pnpm mobile:keys:init` creates `ota-certificate.pem` in this directory.
It also creates `android-release-certificate.sha256`, which pins the public
SHA-256 fingerprint of the long-lived Android release certificate.

Both files contain public information and are intended to be committed. The
matching private keys are created only under the ignored
`.anybox-mobile-keys` directory and in the two encrypted backup destinations
supplied to the command.

Release builds intentionally fail while either public identity file is missing.
