# Chrome Web Store branding

The icons in `icons/` are store-only derivatives of
`packages/mobile-app/assets/icon.png`, the Anybox box-cat app icon.

Do not replace the internal extension icons in `public/icons/` with these files.
The internal Anybox Chrome plugin intentionally keeps the Chrome-oriented icon,
while `tools/package-chrome-web-store.mjs` overlays the box-cat icon set only in
the temporary Chrome Web Store staging directory.
