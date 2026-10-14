# QNAP for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration that
monitors a **QNAP NAS** running **QTS** or **QuTS hero** over your local
network: CPU, memory, temperatures, fans, network, volumes, disks and the UPS
it shares, with scene triggers when a volume or a disk needs attention or a
firmware update is out, and a dashboard widget.

> **Not affiliated with QNAP.** Not endorsed or sponsored by QNAP Systems, Inc.
> QNAP, QTS and QuTS hero are trademarks of their respective owners, named here
> only to describe compatibility.

> **Developed without the hardware: feedback welcome.** No NAS was available
> while writing this integration: it reads the same API as the Home Assistant
> integration and python-qnapstats, and is tested against real answers of nine
> QNAP models (QTS 4.2 to 4.5). Reports from real NAS, QTS 5 and QuTS hero
> especially, are the most useful contribution:
> [open an issue](https://github.com/guim31/gladys-qnap/issues).

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

## Features

- **The NAS**: online, CPU and memory use, CPU and system temperatures, the
  speed of each fan, download and upload of each network interface, uptime,
  firmware version, firmware update available.
- **One device per volume**: space used (%), capacity and free space (GB),
  state (ready, rebuilding, degraded or abnormal) and an alert flag.
- **One device per disk**: temperature, SMART summary (good, warning, error)
  and an alert flag; its model is the model of the device.
- **The UPS** the NAS shares as network UPS master: battery, runtime, load, on
  battery, low battery.
- **Scene triggers**: _Volume degraded_, _Disk alert_, _Firmware update
  available_ — fired on transitions only, remembered across restarts.
- **Scene actions**: _Restart the QNAP NAS_ and _Shut down the QNAP NAS_,
  refused unless allowed in the configuration (off by default). Nothing else
  can be changed on the NAS.
- **Dashboard widget** _QNAP NAS_: CPU and memory gauges, temperature, what
  needs attention first, then the volumes, the UPS and the uptime.
- Feature names, states and messages in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later.
- A QNAP NAS running QTS or QuTS hero, reachable from Gladys on its web port
  (8080 over HTTP, 443 over HTTPS by default).
- An account of the NAS **without 2-step verification**, dedicated to Gladys:
  with the _System Monitoring_ role (delegated administration) to read, or in
  the administrators group on firmwares without delegated administration.
  Restart, shutdown and the firmware check need an administrator.
- For the UPS: _Enable network UPS support_ on the NAS, with the address of
  the Gladys machine among the allowed IPs (NUT, TCP port 3493).

## Installation

1. In Gladys, **Integrations → Install from GitHub**, then
   `https://github.com/guim31/gladys-qnap` (or install **QNAP** from the
   store once it is listed).
2. In its **Configuration** tab, enter the address of the NAS (e.g.
   `192.168.1.50`, or `https://192.168.1.50`), the user name and the password,
   then save.
3. Use **Test the connection** to check what was found.
4. Add the NAS, its volumes, disks and UPS from the **Discover** tab.

## How it works

The integration logs in to the CGI API of the QTS web interface
(`POST /cgi-bin/authLogin.cgi`, the password base64-encoded as QTS expects —
prefer HTTPS) and keeps the session id, under `/data` too, so a restart does
not log in again. At each refresh (every 1, 2 or 5 minutes):

- `management/manaRequest.cgi?subfunc=sysinfo`: CPU, memory, temperatures,
  fans, uptime, model, firmware;
- `management/chartReq.cgi?chart_func=disk_usage`: volumes and their usage;
- `management/chartReq.cgi?chart_func=QSM40bandwidth` (`bandwidth` since QTS
  4.5.4): network rates;
- `disk/qsmart.cgi?func=all_hd_data`, every 5 minutes: disks;
- `sys/sysRequest.cgi?subfunc=firm_update`, every 6 hours: firmware offered;
- `LIST VAR qnapups` on the NUT server of the NAS: the UPS.

Restart and shutdown use `sys/sysRequest.cgi?subfunc=power_mgmt`, only from a
scene, only when allowed. Devices are published with `should_poll: false`: the
integration reads the NAS on its own timer and sends only the values that
changed (and every value again after 6 hours). A refused password is never
retried on its own: QTS blocks an address after a few failed logins.

## Checked, and what was not

Checked here: the parsing of real answers of nine models
([`test/fixtures/qnap/`](test/fixtures/qnap)), the login and session flow
against a fake NAS, the conformity of every device with the Gladys core
([`test/gladys-rules.test.js`](test/gladys-rules.test.js)), the widget against
the validator of the SDK, the NUT exchange against a local server.

**Not checked on a real NAS:** QTS 5.x and QuTS hero answers (expected to be
the same API), the volume state codes other than "ready" (any other code is
reported as degraded or abnormal), the answer of a 2-step verification account
(`need_2sv`), the rights of a _System Monitoring_ account, the answer to the
restart and shutdown requests, and the NUT server of a QNAP master. The
script [`scripts/probe.mjs`](scripts/probe.mjs) checks the first ones on a real
NAS, read only.

## Limitations

- One NAS per installation.
- No 2-step verification.
- Applications, shared folders, snapshots, Container Station and virtual
  machines are not read.
- Gladys has no rpm unit: fan speeds are plain numbers.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store .
QNAP_URL=http://192.0.2.50:8080 QNAP_USER=gladys QNAP_PASSWORD=… node scripts/probe.mjs
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory NAS ([`test/helpers/fakeQnap.js`](test/helpers/fakeQnap.js)).
See [`CLAUDE.md`](CLAUDE.md) for the project rules.

### Releasing

Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md),
then open **Actions → Release → Run workflow** and pick `patch`, `minor` or
`major`: the workflow bumps the version everywhere, moves the changelog
section, pushes the `vX.Y.Z` tag, builds the multi-arch image to `ghcr.io` and
publishes the GitHub Release.

> Prefer the terminal? `git tag v1.0.0 && git push --tags` triggers the same
> build and Release, but does **not** touch `package.json`, `CHANGELOG.md` or
> the manifest: bump `version` in `package.json` and in
> `gladys-assistant-integration.json` (with the `docker_image` tag) and commit
> it **before** tagging.

## Credits

- [colinodell/python-qnapstats](https://github.com/colinodell/python-qnapstats)
  (MIT) by Colin O'Dell and contributors: the endpoints, their fields, and the
  real answers used as test fixtures (anonymized, see
  [`test/fixtures/qnap/`](test/fixtures/qnap)).
- The [Home Assistant `qnap` integration](https://www.home-assistant.io/integrations/qnap/)
  (Apache-2.0): what is worth reading and how often.
- [tommasomarchionni/qnapcli](https://github.com/tommasomarchionni/qnapcli)
  (MIT): the restart and shutdown requests.
- [Network UPS Tools](https://networkupstools.org/): the protocol of the UPS.
- The architecture and the conformity tests follow
  [gladys-ugreen-nas](https://github.com/guim31/gladys-ugreen-nas), started
  from the official
  [integration template](https://github.com/GladysAssistant/integration-template-js).

## License

Apache-2.0
