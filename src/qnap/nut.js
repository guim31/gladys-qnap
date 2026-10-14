// -----------------------------------------------------------------------------
// The UPS of the NAS, read through Network UPS Tools (NUT).
//
// QTS has no documented CGI for its UPS page, but a QNAP NAS that drives a
// UPS (USB or SNMP) can share it as a "network UPS master" (Control Panel →
// External Device → UPS → "Enable network UPS support"): it then runs a
// standard NUT server on TCP port 3493 and names the UPS `qnapups`, the name
// every QNAP slave and NUT client uses. Only the IP addresses listed there may
// read it: the address of the Gladys machine must be one of them.
//
// Reading needs no login: `LIST VAR qnapups` answers every variable, one line
// each (`VAR qnapups battery.charge "100"`), between `BEGIN LIST VAR` and
// `END LIST VAR`. Nothing is ever written to the UPS.
//
// The variables used (NUT names, docs/developer-guide "variables"):
//   ups.status       OL (on line) | OB (on battery) | LB (low battery) | CHRG …
//   battery.charge   %            battery.runtime  seconds
//   ups.load         %            ups.mfr / ups.model / device.model
// -----------------------------------------------------------------------------

import net from 'node:net';

export const NUT_PORT = 3493;
export const QNAP_UPS_NAME = 'qnapups';

export const NUT_ERRORS = Object.freeze({
  ABSENT: 'absent', // no NUT server, or no UPS under that name: the NAS shares no UPS
  DENIED: 'denied', // a NUT server answers, but refuses this address
  FAILED: 'failed', // any other answer
});

export class NutError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'NutError';
    this.kind = kind;
  }
}

const MAX_ANSWER = 64 * 1024;

/**
 * The default transport: one TCP exchange, the whole answer up to the end
 * marker. Replaced by the tests (test/helpers/fakeQnap.js).
 * @param {{ host: string, port: number, lines: string[], until: RegExp, timeoutMs: number }} options
 * @returns {Promise<string>}
 */
export function nutExchange({ host, port, lines, until, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let answer = '';
    let settled = false;
    const socket = net.createConnection({ host, port });
    const done = (err, value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      if (err) {
        reject(err);
      } else {
        resolve(value);
      }
    };
    socket.setTimeout(timeoutMs, () => {
      const error = new Error(`Timed out after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      done(error);
    });
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(lines.map((line) => `${line}\n`).join('')));
    socket.on('data', (chunk) => {
      answer += chunk;
      if (answer.length > MAX_ANSWER) {
        done(new Error('Answer too large'));
      } else if (until.test(answer) || /^ERR /m.test(answer)) {
        done(null, answer);
      }
    });
    socket.on('error', (err) => done(err));
    socket.on('end', () => done(null, answer));
  });
}

/** Parse the lines of `LIST VAR`: `VAR <ups> <name> "<value>"`. */
export function parseVariables(answer) {
  const variables = {};
  for (const line of answer.split(/\r?\n/)) {
    const match = line.match(/^VAR \S+ (\S+) "((?:[^"\\]|\\.)*)"$/);
    if (match) {
      variables[match[1]] = match[2].replace(/\\(.)/g, '$1');
    }
  }
  return variables;
}

/**
 * @param {object} options
 * @param {string} options.host the NAS host name or address
 * @param {number} [options.port]
 * @param {string} [options.name] the UPS name on the NUT server
 * @param {Function} [options.exchange] transport seam
 * @param {number} [options.timeoutMs]
 * @returns {Promise<Record<string, string>>} the NUT variables
 */
export async function readUps({
  host,
  port = NUT_PORT,
  name = QNAP_UPS_NAME,
  exchange = nutExchange,
  timeoutMs = 5000,
}) {
  let answer;
  try {
    answer = await exchange({
      host,
      port,
      lines: [`LIST VAR ${name}`, 'LOGOUT'],
      until: new RegExp(`^END LIST VAR ${name}\\s*$`, 'm'),
      timeoutMs,
    });
  } catch (err) {
    throw new NutError(NUT_ERRORS.ABSENT, `No NUT server (${err.code ?? err.message})`);
  }
  const error = answer.match(/^ERR (\S+)/m);
  if (error) {
    if (error[1] === 'ACCESS-DENIED') {
      throw new NutError(NUT_ERRORS.DENIED, 'The NUT server of the NAS refuses this address');
    }
    if (error[1] === 'UNKNOWN-UPS' || error[1] === 'DRIVER-NOT-CONNECTED') {
      throw new NutError(NUT_ERRORS.ABSENT, `No UPS (${error[1]})`);
    }
    throw new NutError(NUT_ERRORS.FAILED, `NUT error ${error[1]}`);
  }
  const variables = parseVariables(answer);
  if (Object.keys(variables).length === 0) {
    throw new NutError(NUT_ERRORS.FAILED, 'Empty NUT answer');
  }
  return variables;
}
