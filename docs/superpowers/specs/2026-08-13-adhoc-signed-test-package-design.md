# Ad-hoc Signed macOS Test Package Design

## Goal

Generate an Apple Silicon test package whose application bundle has a structurally valid recursive ad-hoc signature, so trusted testers can bypass quarantine without macOS reporting that the app is damaged.

## Design

- Replace `mac.identity: null` with `mac.identity: "-"` in `electron-builder.yml`.
- Keep the current hardened-runtime entitlements and package only `arm64` for this test artifact.
- Preserve DMG and ZIP output formats.
- Treat this as a test-distribution package only; it is not Developer ID signed or notarized.

## Verification

1. Build the package with `electron-builder --mac dmg zip --arm64`.
2. Verify the unpacked `.app` using `codesign --verify --deep --strict --verbose=4`.
3. Mount the generated DMG and repeat the same verification against the `.app` inside it.
4. Record artifact sizes and SHA-256 hashes.

