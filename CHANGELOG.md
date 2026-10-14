# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-14

### Added

- Follow a QNAP NAS (QTS, QuTS hero) on the local network through the web API
  of QTS, with an account of the NAS (a System Monitoring account is enough to
  read; restart, shutdown and the firmware check need an administrator).
- The NAS as a device: online, CPU, memory, CPU and system temperatures, the
  speed of each fan, download and upload of each network interface, uptime,
  firmware version, firmware update available.
- One device per volume (space used, capacity, free space, state: ready,
  rebuilding, degraded or abnormal, alert) and per disk (temperature, SMART
  state: good, warning, error, alert).
- The UPS the NAS shares as network UPS master (NUT, port 3493): battery,
  runtime, load, on battery, low battery.
- Scene triggers: volume degraded, disk alert, firmware update available.
- Scene actions: restart and shut down the NAS, refused unless allowed in the
  configuration (off by default).
- A dashboard widget: CPU and memory gauges, temperature, then what needs
  attention, the volumes, the UPS and the uptime, with a Refresh button.
- The integration reads the NAS on its own timer (every 1, 2 or 5 minutes; the
  disks every 5 minutes, the firmware check every 6 hours) and keeps its
  session across restarts, so the NAS does not log a login per minute.
- HTTPS with an optional self-signed certificate; a refused password, a
  2-step verification account or a missing right is reported in words and
  never retried on its own.
- Every text in English, French, German and Spanish, documentation included.

[Unreleased]: https://github.com/guim31/gladys-qnap/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-qnap/releases/tag/v1.0.1
