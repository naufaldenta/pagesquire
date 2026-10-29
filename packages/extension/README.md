# PageSquire Companion (development build)

A Chromium extension that lets a site's PageSquire assistant use real clicks, typing and keys once the visitor allows that site. It only runs action calls signed by the site's server. This build works only on `localhost`, `127.0.0.1`, `*.localhost` and `*.test` sites.

It is not in any extension store yet. Run `npm run build` once, then load it unpacked: open `chrome://extensions`, turn on developer mode, choose **Load unpacked** and select this folder.

- [Design and security](../../docs/companion-extension.md)
- [Trying it on a local site](../../docs/companion-extension.md#development-build-4d-1-to-4d-5)

## Files

| File                | Role                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `manifest.json`     | Manifest V3. Host access only to local and `.test` hosts.                                              |
| `src/worker.js`     | Service worker: grants, debugger sessions, the extension's own checks, stop and audit log.             |
| `src/policy.js`     | Pure rules shared with the unit tests.                                                                 |
| `src/content.js`    | Relay injected only on granted hosts; answers the page on a private `MessagePort`.                     |
| `src/remote.js`     | Remote script for granted frames and session tabs; built with the core observer into `dist/remote.js`. |
| `src/panel.*`       | Side panel: allow, revoke, stop, resume, share a tab, allow screenshots and recent activity.           |
| `_locales/{en,id}/` | English and Indonesian text.                                                                           |

`npm run build` only bundles the remote script. Nothing else is built, and no code is loaded from the network.
