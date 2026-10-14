// -----------------------------------------------------------------------------
// An in-memory QNAP NAS answering the QTS CGI API the way the integration
// reads it (src/qnap/client.js), on a fake network: the login (form or query,
// base64 password compared), the session ids, the `authPassed 0` of an
// expired session, and the read endpoints served from the real answers of
// test/fixtures/qnap (edited in place for a test: CPU, volume state, disk
// health, offered firmware). Its UPS answers the NUT protocol the way a QNAP
// network UPS master does. No socket is opened.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const USERNAME = 'gladys';
// Not a secret: the password of the fake NAS only.
export const PASSWORD = 'fake-password-for-tests';

export const readFixture = (path) =>
  readFileSync(new URL(`../fixtures/qnap/${path}`, import.meta.url), 'utf8');

// The NAS of the tests: a TS-EC1280U (QTS 4.5.2, four fans, six network
// ports) with the volume and the four disks of a TS-451.
export const DEFAULT_FIXTURES = Object.freeze({
  login: 'TS-EC1280U-4.5.2/login.xml',
  sysinfo: 'TS-EC1280U-4.5.2/systemstats.xml',
  volumes: 'TS-451-4.2.2/volumes.xml',
  disks: 'TS-451-4.2.2/smartdiskhealth.xml',
  bandwidth: 'TS-EC1280U-4.5.2/bandwidth.xml',
  firmware: 'TS-420-4.3.3/firmwareupdate.xml',
});

export const NAS_SERIAL = 'Q000TEST0002';
// The TS-451 masks the serial numbers of its disks (all "WD-XXX", anonymized
// as TESTDISK0018): the disks are known by their bay.
export const DISK_KEYS = ['slot-0-1', 'slot-0-2', 'slot-0-3', 'slot-0-4'];

const xml = (body) => ({
  status: 200,
  headers: { 'content-type': 'text/xml' },
  body: `<?xml version="1.0" encoding="UTF-8" ?>\n<QDocRoot version="1.0">${body}</QDocRoot>`,
});
const raw = (body) => ({ status: 200, headers: { 'content-type': 'text/xml' }, body });
const cdata = (value) => `<![CDATA[${value}]]>`;

export class FakeQnap {
  /**
   * @param {object} [options]
   * @param {boolean} [options.otp] the account asks for a 2-step verification code
   * @param {boolean} [options.monitoring] the account may read the system (else authPassed 0)
   * @param {boolean} [options.admin] the account is an administrator (power, firmware)
   * @param {boolean} [options.loginByGet] the POST login answers without authSid (QTS 4.5.1)
   * @param {boolean} [options.bandwidth454] QSM40bandwidth answers without values (QTS 4.5.4+)
   * @param {object} [options.fixtures] files served, see DEFAULT_FIXTURES
   * @param {object|null} [options.ups] NUT variables of the shared UPS, null: none
   */
  constructor({
    otp = false,
    monitoring = true,
    admin = true,
    loginByGet = false,
    bandwidth454 = false,
    fixtures = {},
    ups = null,
  } = {}) {
    this.otp = otp;
    this.monitoring = monitoring;
    this.admin = admin;
    this.loginByGet = loginByGet;
    this.bandwidth454 = bandwidth454;
    const files = { ...DEFAULT_FIXTURES, ...fixtures };
    this.docs = Object.fromEntries(
      Object.entries(files).map(([key, path]) => [key, path ? readFixture(path) : null]),
    );
    // Up to date by default: the firmware offered is the one running.
    this.setFirmwareOffer(null);
    this.sids = new Set();
    this.logins = 0;
    this.failedLogins = 0;
    /** @type {null|'down'|'html'|'tls'} */
    this.failure = null;
    /** Every request received: method, path, query, form. */
    this.requests = [];
    this.powerCalls = [];
    this.nextSid = 1;
    /** NUT: the shared UPS variables, and whether this address is allowed. */
    this.ups = ups;
    this.upsAllowed = true;
    this.nutRequests = 0;
  }

  // --- Edits ------------------------------------------------------------------

  setCpu(percent) {
    this.docs.sysinfo = this.docs.sysinfo.replace(
      /<cpu_usage><!\[CDATA\[[^\]]*\]\]><\/cpu_usage>/,
      `<cpu_usage>${cdata(`${percent} %`)}</cpu_usage>`,
    );
  }

  setFan(index, rpm, alert = false) {
    this.docs.sysinfo = this.docs.sysinfo
      .replace(
        new RegExp(`<sysfan${index}>\\d+</sysfan${index}>`),
        `<sysfan${index}>${rpm}</sysfan${index}>`,
      )
      .replace(
        new RegExp(`<sysfan${index}_stat>-?\\d+</sysfan${index}_stat>`),
        `<sysfan${index}_stat>${alert ? -1 : 0}</sysfan${index}_stat>`,
      );
  }

  /** The state of the volume of the fixture (volumeStatus and Progress). */
  setVolume({ status = 0, progress = 100 } = {}) {
    this.docs.volumes = this.docs.volumes
      .replace(/<volumeStatus><!\[CDATA\[[^\]]*\]\]>/, `<volumeStatus>${cdata(status)}`)
      .replace(/<Progress><!\[CDATA\[[^\]]*\]\]>/, `<Progress>${cdata(progress)}`);
  }

  /** The SMART summary and temperature of the disk in this bay ("0:2"). */
  setDisk(bay, { health, temperature } = {}) {
    this.docs.disks = this.docs.disks
      .split('<entry>')
      .map((entry) => {
        if (!entry.includes(`<HDNo>${cdata(bay)}`)) {
          return entry;
        }
        let edited = entry;
        if (health !== undefined) {
          edited = edited.replace(/<Health><!\[CDATA\[[^\]]*\]\]>/, `<Health>${cdata(health)}`);
        }
        if (temperature !== undefined) {
          edited = edited.replace(
            /<Temperature><oC><!\[CDATA\[[^\]]*\]\]>/,
            `<Temperature><oC>${cdata(temperature)}`,
          );
        }
        return edited;
      })
      .join('<entry>');
  }

  /** The firmware the NAS offers ("5.2.1.3000 Build 20261001"), null: up to date. */
  setFirmwareOffer(offer) {
    this.firmwareOffer = offer;
  }

  setUps(variables) {
    this.ups = variables;
  }

  // --- HTTP -----------------------------------------------------------------------

  /** One HTTP request, as src/qnap/http.js would send it. */
  handle(url, { method = 'GET', body } = {}) {
    const target = new URL(url);
    const query = Object.fromEntries(target.searchParams);
    const form = body ? Object.fromEntries(new URLSearchParams(body)) : {};
    this.requests.push({ method, path: target.pathname, query, form });
    if (this.failure === 'down') {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    if (this.failure === 'tls') {
      const error = new Error('self-signed certificate');
      error.code = 'DEPTH_ZERO_SELF_SIGNED_CERT';
      throw error;
    }
    if (this.failure === 'html') {
      return {
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: '<html><body>Router</body></html>',
      };
    }
    if (target.pathname === '/cgi-bin/authLogin.cgi') {
      return this.login(method === 'POST' ? form : query, method);
    }
    if (!this.sids.has(query.sid)) {
      return xml(`<authPassed>${cdata(0)}</authPassed>`);
    }
    const reader = this.route(target.pathname, query);
    if (!reader) {
      return { status: 404, headers: {}, body: 'Not found' };
    }
    return reader();
  }

  login({ user, pwd }, method) {
    const password = Buffer.from(pwd ?? '', 'base64').toString('utf8');
    if (user !== USERNAME || password !== PASSWORD) {
      this.failedLogins += 1;
      return xml(`<authPassed>${cdata(0)}</authPassed><errorValue>${cdata(-1)}</errorValue>`);
    }
    if (this.otp) {
      return xml(`<authPassed>${cdata(0)}</authPassed><need_2sv>${cdata(1)}</need_2sv>`);
    }
    if (this.loginByGet && method === 'POST') {
      return xml(`<authPassed>${cdata(1)}</authPassed><isAdmin>${cdata(1)}</isAdmin>`);
    }
    this.logins += 1;
    const sid = `fakesid${String(this.nextSid++).padStart(8, '0')}`;
    this.sids.add(sid);
    return raw(
      this.docs.login
        .replace(/<authSid><!\[CDATA\[[^\]]*\]\]>/, `<authSid>${cdata(sid)}`)
        .replace(/<isAdmin><!\[CDATA\[[^\]]*\]\]>/, `<isAdmin>${cdata(this.admin ? 1 : 0)}`)
        .replace(/<username><!\[CDATA\[[^\]]*\]\]>/, `<username>${cdata(USERNAME)}`),
    );
  }

  /** Forget every session: the next request answers authPassed 0. */
  expireSessions() {
    this.sids.clear();
  }

  route(path, query) {
    const monitored = (doc) => () =>
      this.monitoring ? raw(doc()) : xml(`<authPassed>${cdata(0)}</authPassed>`);
    const adminOnly = (fn) => () =>
      this.admin ? fn() : xml(`<authPassed>${cdata(0)}</authPassed>`);
    if (path === '/cgi-bin/management/manaRequest.cgi' && query.subfunc === 'sysinfo') {
      return monitored(() => this.docs.sysinfo);
    }
    if (path === '/cgi-bin/management/chartReq.cgi') {
      if (query.chart_func === 'disk_usage') {
        return monitored(() => this.docs.volumes);
      }
      if (query.chart_func === 'QSM40bandwidth') {
        return monitored(() =>
          this.bandwidth454
            ? this.docs.bandwidth.replace(/<bandwidth_info>[\s\S]*<\/bandwidth_info>/, '')
            : this.docs.bandwidth,
        );
      }
      if (query.chart_func === 'bandwidth') {
        return monitored(() => this.docs.bandwidth);
      }
    }
    if (path === '/cgi-bin/disk/qsmart.cgi' && query.func === 'all_hd_data') {
      return monitored(() => this.docs.disks);
    }
    if (path === '/cgi-bin/sys/sysRequest.cgi' && query.subfunc === 'firm_update') {
      return adminOnly(() => raw(this.firmwareDoc()));
    }
    if (path === '/cgi-bin/sys/sysRequest.cgi' && query.subfunc === 'power_mgmt') {
      return adminOnly(() => {
        this.powerCalls.push(query.apply);
        return xml(`<authPassed>${cdata(1)}</authPassed>`);
      });
    }
    return null;
  }

  /** The firm_update answer, its <firmware> block the one of the running system. */
  firmwareDoc() {
    const running = this.docs.sysinfo.match(/<firmware>[\s\S]*?<\/firmware>/)[0];
    return this.docs.firmware
      .replace(/<firmware>[\s\S]*?<\/firmware>/, running)
      .replace(
        /<newVersion><!\[CDATA\[[^\]]*\]\]>/,
        `<newVersion>${cdata(this.firmwareOffer ?? '')}`,
      );
  }

  // --- NUT --------------------------------------------------------------------------

  /** One NUT exchange, as src/qnap/nut.js would run it. */
  nut({ lines }) {
    this.nutRequests += 1;
    if (this.failure === 'down' || this.ups === null) {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    if (!this.upsAllowed) {
      return 'ERR ACCESS-DENIED\n';
    }
    const name = lines[0].split(' ')[2];
    if (name !== 'qnapups') {
      return 'ERR UNKNOWN-UPS\n';
    }
    return [
      `BEGIN LIST VAR ${name}`,
      ...Object.entries(this.ups).map(([key, value]) => `VAR ${name} ${key} "${value}"`),
      `END LIST VAR ${name}`,
      'OK Goodbye',
      '',
    ].join('\n');
  }
}

/** A UPS on mains, as NUT reports an APC Back-UPS. */
export const UPS_ON_MAINS = Object.freeze({
  'battery.charge': '100',
  'battery.runtime': '1830',
  'ups.load': '18',
  'ups.status': 'OL',
  'ups.mfr': 'American Power Conversion',
  'ups.model': 'Back-UPS ES 700G',
});

/**
 * A fake network: requests go to the NAS whose origin matches, anything else
 * is refused like a closed port. Same for NUT, by host.
 * @param {Record<string, FakeQnap>} nasByOrigin
 */
export function createNetwork(nasByOrigin) {
  return {
    async request(url, options) {
      const nas = nasByOrigin[new URL(url).origin];
      if (!nas) {
        const error = new Error('connect ECONNREFUSED');
        error.code = 'ECONNREFUSED';
        throw error;
      }
      return nas.handle(url, options);
    },
    async nutExchange(options) {
      const nas = Object.entries(nasByOrigin).find(
        ([origin]) => new URL(origin).hostname === options.host,
      )?.[1];
      if (!nas) {
        const error = new Error('connect ECONNREFUSED');
        error.code = 'ECONNREFUSED';
        throw error;
      }
      return nas.nut(options);
    },
  };
}
