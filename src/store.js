// -----------------------------------------------------------------------------
// Small persistence under /data (the only writable path of the container),
// two files:
//
//   - qnap-state.json: what the scene triggers compare with (src/alerts.js),
//     so that a restart of the integration or of Gladys neither misses a
//     transition nor announces one twice. Losing it is harmless: the first
//     read after it only records the states, without scene events;
//   - qnap-session.json: the session id of the NAS, so a restart reuses the
//     open session instead of logging in again (each login is a line in the
//     connection log of the NAS). Written owner-only (0600), bound to the
//     address and the user name, never logged. Losing it costs one login.
//
// The password is never written here: it stays in the Gladys configuration.
// (Adapted from guim31/gladys-ugreen-nas.)
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'qnap-store' });

export const STATE_FILE = 'qnap-state.json';
export const SESSION_FILE = 'qnap-session.json';

class JsonFile {
  constructor(directory, name, mode) {
    this.directory = directory;
    this.path = join(directory, name);
    this.mode = mode;
    this.pending = null;
    this.writing = null;
    this.written = null;
    this.failing = false;
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      this.written = JSON.stringify(data);
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Cannot read ${this.path}: ${err.message}`);
      }
      return {};
    }
  }

  // Writes are coalesced, skipped when nothing changed, and atomic (temporary
  // file + rename): a crash never leaves half a JSON file behind.
  save(data) {
    this.latest = JSON.stringify(data);
    if (!this.pending) {
      // Chained after the write in progress, if any: one writer at a time.
      this.pending = (this.writing ?? Promise.resolve()).then(async () => {
        const snapshot = this.latest;
        this.pending = null;
        if (snapshot === this.written) {
          return;
        }
        try {
          await mkdir(this.directory, { recursive: true });
          const temporary = `${this.path}.tmp`;
          await writeFile(temporary, snapshot, { mode: this.mode });
          await rename(temporary, this.path);
          this.written = snapshot;
          if (this.failing) {
            this.failing = false;
            logger.info(`${this.path} written again`);
          }
        } catch (err) {
          // Tried again at every read until it works: one line, not one per read.
          (this.failing ? logger.debug : logger.warn)(`Cannot write ${this.path}: ${err.message}`);
          this.failing = true;
        }
      });
      this.writing = this.pending;
    }
    return this.pending;
  }

  flush() {
    return this.writing ?? Promise.resolve();
  }
}

/** What a session id is bound to: the address and the user name (hashed). */
export const sessionOwner = (url, username) =>
  createHash('sha256').update(`${url}\n${username}`).digest('hex').slice(0, 32);

export class Store {
  constructor(directory = process.env.QNAP_DATA_DIR || '/data') {
    this.directory = directory;
    this.state = new JsonFile(directory, STATE_FILE, 0o644);
    this.session = new JsonFile(directory, SESSION_FILE, 0o600);
    this.sessionData = null;
  }

  /** The trigger tables. */
  load() {
    return this.state.load();
  }

  save(data) {
    return this.state.save(data);
  }

  /** The session id kept for this address and user, or null. */
  async loadSession(url, username) {
    this.sessionData ??= await this.session.load();
    const { owner, sid } = this.sessionData;
    return owner === sessionOwner(url, username) && typeof sid === 'string' && sid ? sid : null;
  }

  saveSession(url, username, sid) {
    this.sessionData = sid ? { owner: sessionOwner(url, username), sid } : {};
    return this.session.save(this.sessionData);
  }

  /** Resolves once every write requested so far is on disk. */
  async flush() {
    await Promise.all([this.state.flush(), this.session.flush()]);
  }
}
