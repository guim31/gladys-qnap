// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One NAS per installation: the address of its web interface (port 8080 over
// HTTP by default, 443 over HTTPS), an account of the NAS, whether its
// self-signed certificate is accepted, the refresh interval, whether to read
// the UPS it shares, whether scenes may restart or shut it down, and the
// language of the texts sent to Gladys.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// The QTS web interface (and its CGI API) answers over HTTP on this port.
export const DEFAULT_PORT = 8080;

// Refresh intervals offered in the configuration, in seconds: one minute at
// most often, the cadence of the Home Assistant integration.
export const POLL_INTERVALS = ['60', '120', '300'];

export const DEFAULT_CONFIG = {
  address: '',
  username: '',
  password: '',
  accept_self_signed: false,
  poll_interval: '60',
  ups: true,
  allow_power_actions: false,
  language: 'fr',
};

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.50`, port 8080 added), `host:port` (HTTPS when the port is 443),
 * or a URL copied from the browser (`https://192.0.2.50/cgi-bin/`). The path
 * is dropped: the API always lives under `/cgi-bin/` at the root.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port]`, null when unusable
 */
export function parseAddress(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const value = raw.trim();
  if (!value) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  let url;
  try {
    url = new URL(hasScheme ? value : `http://${value}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the messages.
  if (url.username || url.password) {
    return null;
  }
  if (!hasScheme) {
    if (!url.port) {
      url.port = String(DEFAULT_PORT);
    } else if (url.port === '443') {
      return `https://${url.hostname.includes(':') ? `[${url.hostname}]` : url.hostname}`;
    }
  }
  return url.origin;
}

/** Host part shown to the user (no scheme, no default port). */
export const hostOf = (url) =>
  url.replace(/^https?:\/\//, '').replace(new RegExp(`:${DEFAULT_PORT}$`), '');

/** The host name or address alone, for the NUT server of the NAS. */
export const hostnameOf = (url) => new URL(url).hostname.replace(/^\[|\]$/g, '');

const bool = (value, fallback) => {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === 0 || value === '0') {
    return false;
  }
  return fallback;
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 * @returns {{ url: string|null, addressInvalid: boolean, username: string, password: string,
 *   insecure: boolean, pollIntervalMs: number, ups: boolean, powerActions: boolean,
 *   language: string }}
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const read = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, choices) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return choices.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  const typed = read('address');
  const url = parseAddress(typed);
  return {
    url,
    addressInvalid: Boolean(typed) && url === null,
    username: read('username'),
    // A pasted password often carries a trailing new line; spaces are kept.
    password:
      typeof source.password === 'string' ? source.password.replace(/^[\r\n]+|[\r\n]+$/g, '') : '',
    insecure: bool(source.accept_self_signed, DEFAULT_CONFIG.accept_self_signed),
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    ups: bool(source.ups, DEFAULT_CONFIG.ups),
    powerActions: bool(source.allow_power_actions, DEFAULT_CONFIG.allow_power_actions),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/** Whether the configuration has everything needed to log in. */
export const isComplete = (config) => Boolean(config.url && config.username && config.password);
