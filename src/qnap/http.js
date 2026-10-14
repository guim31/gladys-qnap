// -----------------------------------------------------------------------------
// The one function that talks HTTP to the NAS: a request on node:http /
// node:https. Not on fetch: fetch cannot accept the self-signed certificate a
// QNAP NAS serves over HTTPS by default, node:https can, per request (only
// when the user ticked the option). (From guim31/gladys-ugreen-nas.)
//
// The client takes this function as a parameter: the tests replace it with an
// in-memory NAS (test/helpers/fakeQnap.js).
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

// The answers of a NAS with many disks weigh a few tens of kB.
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * @param {string} url absolute URL
 * @param {object} [options]
 * @param {'GET'|'POST'} [options.method]
 * @param {Record<string, string>} [options.headers]
 * @param {string} [options.body]
 * @param {boolean} [options.insecure] accept a certificate that does not verify (HTTPS only)
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
export function httpRequest(
  url,
  { method = 'GET', headers = {}, body, insecure = false, timeoutMs = 15_000 } = {},
) {
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';

  return new Promise((resolve, reject) => {
    const request = (isHttps ? https : http).request(
      target,
      {
        method,
        headers:
          body === undefined ? headers : { ...headers, 'Content-Length': Buffer.byteLength(body) },
        timeout: timeoutMs,
        ...(isHttps ? { rejectUnauthorized: !insecure } : {}),
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            const error = new Error('Response too large');
            error.code = 'ERESPONSETOOLARGE';
            request.destroy(error);
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () => {
      const error = new Error(`Timed out after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    if (body !== undefined) {
      request.write(body);
    }
    request.end();
  });
}
