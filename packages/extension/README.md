# PageSquire Companion (development build)

A Chromium extension that lets a site's PageSquire assistant use real clicks, typing and keys, after the visitor allows that site. It runs only action calls signed by the site's server, and this build works only on `localhost`, `127.0.0.1`, `*.localhost` and `*.test` sites.

It is not published to any extension store. Load it unpacked: open `chrome://extensions`, turn on developer mode, choose **Load unpacked** and select this folder.

- [Design, security invariants and spike results](../../docs/companion-extension.md)
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

Run `npm run build` once before loading it: it bundles the remote script. Nothing else is built, and no code is loaded remotely.
