// -----------------------------------------------------------------------------
// What the scene triggers compare with, read after read: the state of every
// volume and disk, and the firmware the NAS offers. Pure bookkeeping, no I/O:
// the hub (src/hub.js) feeds it every read and fires the events it returns.
// The tables live in /data (src/store.js) so a restart neither repeats an
// announcement nor misses one.
//
//   - a volume or a disk is announced when its state needs attention and is
//     worse than the one recorded: good -> warning fires, warning -> error
//     fires again, error -> warning does not (it is getting better). Back to
//     good re-arms it;
//   - a firmware update is announced once per version offered.
//
// The first time an item is seen, its state is recorded without any event:
// nothing has changed, and no scene could exist yet at the very first read.
// The tables are those of one NAS: another serial number starts them afresh.
// (Adapted from guim31/gladys-ugreen-nas.)
// -----------------------------------------------------------------------------

import { DISK_STATES, VOLUME_STATES } from './qnap/model.js';

const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export class Watcher {
  constructor(saved = {}) {
    const tables = object(saved);
    this.saved = {
      nas: typeof tables.nas === 'string' ? tables.nas : null,
      volumes: object(tables.volumes),
      disks: object(tables.disks),
      // undefined: never checked; null: checked, up to date; a string: the version announced.
      firmware:
        typeof tables.firmware === 'string' || tables.firmware === null
          ? tables.firmware
          : undefined,
    };
  }

  /** Bind the tables to a NAS; returns whether they were reset. */
  bind(nasId) {
    if (this.saved.nas === nasId) {
      return false;
    }
    this.saved = { nas: nasId, volumes: {}, disks: {}, firmware: undefined };
    return true;
  }

  static transitions(table, items, states) {
    const events = [];
    for (const item of items) {
      const previous = table[item.key];
      table[item.key] = item.state;
      if (previous === undefined || !states[previous]) {
        continue;
      }
      const now = states[item.state];
      if (now.alert && now.severity > states[previous].severity) {
        events.push(item);
      }
    }
    return events;
  }

  /** @returns {Array<object>} the volumes whose state just got worse */
  volumes(volumes) {
    return Watcher.transitions(this.saved.volumes, volumes ?? [], VOLUME_STATES);
  }

  /** @returns {Array<object>} the disks whose state just got worse */
  disks(disks) {
    return Watcher.transitions(this.saved.disks, disks ?? [], DISK_STATES);
  }

  /**
   * The firmware the NAS offers, after a check.
   * @param {{ version: string }|null} update null when up to date
   * @returns {boolean} whether this version is news
   */
  firmware(update) {
    const previous = this.saved.firmware;
    const version = update?.version ?? null;
    this.saved.firmware = version;
    return version !== null && previous !== undefined && previous !== version;
  }
}
