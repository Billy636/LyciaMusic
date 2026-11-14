# Windows installer customization

`installer.nsi` is based on Tauri's official template at tag `tauri-cli-v2.9.6`:
https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.9.6/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi

Local changes:

- Existing NSIS installations skip the maintenance choice and overwrite program files without invoking the old uninstaller.
- Explicitly enable file replacement after the standard running-process check.
- Retain the upstream handling for MSI/WiX migration, WebView2, shortcuts, and uninstalling through Windows Settings.
- Simplified Chinese is selected through `bundle.windows.nsis.languages` in `tauri.conf.json`.

When updating Tauri CLI, compare this template with the matching upstream version before packaging. Do not replace it with generated files from `target`, which contain machine-specific paths.

Packaging verification: compile the installer and inspect the generated script for `SimpChinese`, the NSIS-only skip before dialog creation, previous-install-location restoration, and running-process checks. Validate installation/upgrade on a disposable Windows environment before distribution; do not run a silent installer against a developer's real installation just to check the UI.
