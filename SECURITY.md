# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration holds, and where:

- **The password of the NAS account** lives in the Gladys configuration only.
  It is sent to the NAS at login, base64-encoded as QTS expects (use HTTPS to
  have it encrypted on the network), and never written in the logs, under
  `/data` or in anything sent to Gladys.
- **The session id** of the NAS is kept in memory and in
  `/data/qnap-session.json` (owner-only, bound to the address and the user
  name), so a restart does not log in again. It is never logged.
- **`/data/qnap-state.json`** holds what the scene triggers compare with: the
  serial number of the NAS, the state of each volume and disk, the last
  firmware version announced. No secret.
- **Network**: the container talks to the NAS only, on its web port (8080 or
  443 by default) and, when the UPS option is on, on the NUT port 3493 (read
  only, no login). A self-signed certificate is only accepted when the user
  ticks the option. Nothing reaches the Internet.
- **Commands**: the only requests that change something on the NAS are
  restart and shutdown, sent only by a scene action and only when the user
  allowed them in the configuration (off by default).

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
QTS, QuTS hero and the NAS, and the third-party services and devices the
integration talks to.
