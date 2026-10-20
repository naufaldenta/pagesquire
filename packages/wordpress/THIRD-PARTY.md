# Distribution notices

The WordPress integration is GPL-3.0-or-later (see `LICENSE`). It combines MIT shared PageSquire code with Apache-2.0 PHP dependencies; GPLv3 is used for the combined plugin, not GPLv2-only. Shared packages outside this distribution remain MIT.

| Component                                 | License    | Distribution location                                     |
| ----------------------------------------- | ---------- | --------------------------------------------------------- |
| PageSquire shared runtime/client/protocol | MIT        | `assets/SHARED-MIT-LICENSE`, `runtime/pagesquire/LICENSE` |
| Ajv generated browser validators          | MIT        | `assets/AJV-LICENSE`                                      |
| fflate browser ZIP creation               | MIT        | `assets/FFLATE-LICENSE`                                   |
| Opis JSON Schema 2.6.0                    | Apache-2.0 | `runtime/opis/json-schema/LICENSE`                        |
| Opis String 2.1.0                         | Apache-2.0 | `runtime/opis/string/LICENSE`                             |
| Opis URI 1.1.0                            | Apache-2.0 | `runtime/opis/uri/LICENSE`                                |

Opis and shared PHP namespaces are mechanically prefixed `PageSquireWPVendor` during the build; this modification isolates dependencies from other installed plugins. Original license and notice files are preserved. Source PHP, frontend source modules and source maps accompany the ZIP. `corresponding-source.zip` contains the editable shared/integration sources, validator inputs, lockfiles and build/test scripts; extract it outside the web root and follow README.md to rebuild. Build-time PHP-Scoper is not included in the plugin. WordPress, WP-CLI and SQLite binaries/databases are development-only downloads and are not bundled in the plugin ZIP. Test harness sources use synthetic data and are never loaded by the installed plugin. No mascot or Rive asset is redistributed.
