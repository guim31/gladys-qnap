// -----------------------------------------------------------------------------
// QTS client: the CGI API the web interface of a QNAP NAS uses (QTS and
// QuTS hero), under `/cgi-bin/`, port 8080 over HTTP or 443 over HTTPS by
// default. Every answer is XML (src/qnap/xml.js).
//
// Endpoints and fields as python-qnapstats (Colin O'Dell, MIT) reads them on
// real NAS, the library behind the Home Assistant `qnap` integration:
//
//   login     POST authLogin.cgi  user=…&pwd=<base64 of the UTF-8 password>
//             -> authPassed 1 + authSid; some firmwares answer the POST
//             without authSid and want the same query as a GET (QTS 4.5.1).
//             An account with 2-step verification answers need_2sv=1.
//   sysinfo   management/manaRequest.cgi?subfunc=sysinfo&hd=no&multicpu=1
//   volumes   management/chartReq.cgi?chart_func=disk_usage&disk_select=all&include=all
//   disks     disk/qsmart.cgi?func=all_hd_data
//   network   management/chartReq.cgi?chart_func=QSM40bandwidth, or
//             chart_func=bandwidth since QTS 4.5.4 (the first answers without
//             `bandwidth_info` there)
//   firmware  sys/sysRequest.cgi?subfunc=firm_update
//   power     sys/sysRequest.cgi?subfunc=power_mgmt&count=0&apply=restart|shutdown
//             (as tommasomarchionni/qnapcli, MIT, sends it)
//
// Every request carries the session id `sid`. An expired session answers
// `authPassed 0`: the client logs in again once and repeats the request;
// `authPassed 0` again means the account may not read this (permission).
//
// The session id is kept under /data (src/store.js) so a restart does not open
// a new session on the NAS (each login writes a line in its connection log).
// The password and the session id are never logged, never put in an error
// message, never in a URL written to the logs.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';
import { XmlError, parseQDoc, text } from './xml.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: off, wrong address, firewall
  AUTH: 'auth', // user name or password refused
  OTP: 'otp', // the account asks for a 2-step verification code
  PERMISSION: 'permission', // logged in, but the account may not read the system information
  CERTIFICATE: 'certificate', // HTTPS certificate refused (self-signed without the option)
  NOT_QNAP: 'not_qnap', // something answers, not the QTS API
  HTTP: 'http', // any other HTTP or API error
});

export class QnapError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'QnapError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

export const PATHS = Object.freeze({
  LOGIN: '/cgi-bin/authLogin.cgi',
  SYSINFO: '/cgi-bin/management/manaRequest.cgi',
  CHART: '/cgi-bin/management/chartReq.cgi',
  DISKS: '/cgi-bin/disk/qsmart.cgi',
  SYSTEM: '/cgi-bin/sys/sysRequest.cgi',
});

export const QUERIES = Object.freeze({
  SYSINFO: { subfunc: 'sysinfo', hd: 'no', multicpu: '1' },
  VOLUMES: { chart_func: 'disk_usage', disk_select: 'all', include: 'all' },
  DISKS: { func: 'all_hd_data' },
  BANDWIDTH: { chart_func: 'QSM40bandwidth' },
  BANDWIDTH_454: { chart_func: 'bandwidth' },
  FIRMWARE: { subfunc: 'firm_update' },
  POWER: { subfunc: 'power_mgmt', count: '0' },
});

export const POWER_ACTIONS = Object.freeze({ RESTART: 'restart', SHUTDOWN: 'shutdown' });

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
  'ESOCKETTIMEDOUT',
]);

const CERTIFICATE_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** The password the way QTS expects it: base64 of its UTF-8 bytes (not a protection). */
export const encodePassword = (password) => Buffer.from(password, 'utf8').toString('base64');

const flag = (doc, key) => text(doc, key) === '1';

export class QnapClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL (src/config.js parseAddress)
   * @param {string} options.username
   * @param {string} options.password
   * @param {boolean} [options.insecure] accept a certificate that does not verify
   * @param {Function} [options.request] HTTP seam (src/qnap/http.js)
   * @param {string|null} [options.sid] a session id kept from a previous run
   * @param {(sid: string|null) => void} [options.onSession] called when the session id changes
   */
  constructor({
    url,
    username,
    password,
    insecure = false,
    request = httpRequest,
    sid = null,
    onSession = () => {},
  }) {
    this.url = url;
    this.username = username;
    this.insecure = insecure;
    this.request = request;
    this.onSession = onSession;
    // Not enumerable: never serialized with the client (logs, JSON dumps).
    Object.defineProperty(this, 'password', { value: password, enumerable: false });
    Object.defineProperty(this, 'sid', { value: sid, enumerable: false, writable: true });
    /** What the login said of the account: { admin, hero } (null before a login). */
    this.account = null;
  }

  setSession(sid) {
    if (sid !== this.sid) {
      this.sid = sid;
      this.onSession(sid);
    }
  }

  /** One HTTP exchange, network errors turned into QnapError; the URL never reaches a message. */
  async exchange(path, { method = 'GET', query = {}, form = null }) {
    const target = new URL(path, this.url);
    for (const [key, value] of Object.entries(query)) {
      target.searchParams.set(key, value);
    }
    let response;
    try {
      response = await this.request(target.toString(), {
        method,
        insecure: this.insecure,
        timeoutMs: 15_000,
        ...(form
          ? {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams(form).toString(),
            }
          : {}),
      });
    } catch (err) {
      if (CERTIFICATE_CODES.has(err.code)) {
        throw new QnapError(ERROR_KINDS.CERTIFICATE, `HTTPS certificate refused (${err.code})`);
      }
      if (NETWORK_CODES.has(err.code) || err.code === undefined) {
        // Never the message: it may hold the URL, the login query included.
        throw new QnapError(ERROR_KINDS.UNREACHABLE, `No answer (${err.code ?? err.name})`);
      }
      throw new QnapError(ERROR_KINDS.HTTP, `Request failed (${err.code})`);
    }
    if (response.status === 404) {
      throw new QnapError(ERROR_KINDS.NOT_QNAP, 'HTTP 404: no QTS API here', { status: 404 });
    }
    if (response.status !== 200) {
      throw new QnapError(ERROR_KINDS.HTTP, `HTTP ${response.status}`, {
        status: response.status,
      });
    }
    try {
      return parseQDoc(response.body);
    } catch (err) {
      if (err instanceof XmlError) {
        throw new QnapError(ERROR_KINDS.NOT_QNAP, `Not a QTS answer (${err.message})`);
      }
      throw err;
    }
  }

  async login() {
    const form = { user: this.username, pwd: encodePassword(this.password) };
    let doc = await this.exchange(PATHS.LOGIN, { method: 'POST', form });
    if (flag(doc, 'authPassed') && !text(doc, 'authSid') && !flag(doc, 'need_2sv')) {
      // QTS 4.5.1 on some models: the POST answers without the session id.
      doc = await this.exchange(PATHS.LOGIN, { query: form });
    }
    // 2-step verification: QTS asks for the code before giving a session.
    if (flag(doc, 'need_2sv') || flag(doc, 'force_2sv')) {
      this.setSession(null);
      throw new QnapError(ERROR_KINDS.OTP, 'The account asks for a 2-step verification code');
    }
    const sid = text(doc, 'authSid');
    if (!flag(doc, 'authPassed') || !sid) {
      this.setSession(null);
      throw new QnapError(ERROR_KINDS.AUTH, 'User name or password refused');
    }
    this.account = {
      admin: flag(doc, 'isAdmin'),
      hero: flag(doc, 'hero_model'),
    };
    this.setSession(sid);
  }

  /**
   * A GET under the session; logs in when there is none, or again once when
   * the NAS answers `authPassed 0` (expired session).
   */
  async get(path, query) {
    if (!this.sid) {
      await this.login();
    }
    let doc = await this.exchange(path, { query: { ...query, sid: this.sid } });
    if (text(doc, 'authPassed') !== '0') {
      return doc;
    }
    await this.login();
    doc = await this.exchange(path, { query: { ...query, sid: this.sid } });
    if (text(doc, 'authPassed') === '0') {
      throw new QnapError(
        ERROR_KINDS.PERMISSION,
        'Logged in, but the account may not read this (administrators group or System Monitoring needed)',
      );
    }
    return doc;
  }

  sysinfo() {
    return this.get(PATHS.SYSINFO, QUERIES.SYSINFO);
  }

  volumes() {
    return this.get(PATHS.CHART, QUERIES.VOLUMES);
  }

  disks() {
    return this.get(PATHS.DISKS, QUERIES.DISKS);
  }

  async bandwidth() {
    const doc = await this.get(PATHS.CHART, QUERIES.BANDWIDTH);
    if (doc.bandwidth_info !== undefined) {
      return doc;
    }
    // QTS 4.5.4 and later answer the old query without values.
    return this.get(PATHS.CHART, QUERIES.BANDWIDTH_454);
  }

  firmware() {
    return this.get(PATHS.SYSTEM, QUERIES.FIRMWARE);
  }

  /**
   * Restart or shut down the NAS. Only ever called by a scene action the user
   * enabled in the configuration (src/app.js).
   * @param {'restart'|'shutdown'} action one of POWER_ACTIONS
   */
  async power(action) {
    if (!Object.values(POWER_ACTIONS).includes(action)) {
      throw new Error(`Unknown power action ${action}`);
    }
    await this.get(PATHS.SYSTEM, { ...QUERIES.POWER, apply: action });
  }

  /**
   * Everything one refresh needs. The system information is mandatory (its
   * failure is the failure of the read); every other part may fail alone,
   * its error kept in `errors`.
   * @param {object} [parts] { disks, firmware }: whether to read them this time
   */
  async read({ disks = true, firmware = false } = {}) {
    const raw = { sysinfo: await this.sysinfo(), errors: {} };
    const optional = async (key, fn) => {
      try {
        raw[key] = await fn();
      } catch (err) {
        if (!(err instanceof QnapError) || err.kind === ERROR_KINDS.UNREACHABLE) {
          // The NAS stopped answering in the middle: the whole read failed.
          throw err;
        }
        raw[key] = null;
        raw.errors[key] = err;
      }
    };
    await optional('volumes', () => this.volumes());
    await optional('bandwidth', () => this.bandwidth());
    if (disks) {
      await optional('disks', () => this.disks());
    }
    if (firmware) {
      await optional('firmware', () => this.firmware());
    }
    return raw;
  }
}
