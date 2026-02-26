const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ShelfStore {
  constructor(dataDir, deviceId) {
    this.dataDir = dataDir;
    this.deviceId = deviceId;
    this.filePath = path.join(dataDir, 'shelf-data.json');
    this.data = { shelves: [], files: [], deletedShelfIds: [] };
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      this.data = JSON.parse(raw);
      if (!Array.isArray(this.data.shelves)) this.data.shelves = [];
      if (!Array.isArray(this.data.files)) this.data.files = [];
      if (!Array.isArray(this.data.deletedShelfIds)) this.data.deletedShelfIds = [];
    } catch {
      this.data = { shelves: [], files: [], deletedShelfIds: [] };
    }
  }

  _save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('[ShelfStore] Failed to save:', err.message);
    }
  }

  // --- Init ---

  /** Ensure a "General" shelf exists on first launch */
  ensureDefaults() {
    if (this.data.shelves.length === 0) {
      this.createShelf('General', true);
    }
  }

  // --- Shelf CRUD ---

  createShelf(name, autoPin = true) {
    const now = Date.now();
    const shelf = {
      id: crypto.randomBytes(6).toString('hex'),
      name,
      createdAt: now,
      updatedAt: now,
      createdBy: this.deviceId,
      autoPin,
    };
    this.data.shelves.push(shelf);
    this._save();
    return shelf;
  }

  deleteShelf(shelfId) {
    this.data.shelves = this.data.shelves.filter(s => s.id !== shelfId);
    this.data.files = this.data.files.filter(f => f.shelfId !== shelfId);
    if (!this.data.deletedShelfIds.includes(shelfId)) {
      this.data.deletedShelfIds.push(shelfId);
    }
    this._save();
  }

  renameShelf(shelfId, name) {
    const shelf = this.data.shelves.find(s => s.id === shelfId);
    if (shelf) {
      shelf.name = name;
      shelf.updatedAt = Date.now();
      this._save();
    }
    return shelf || null;
  }

  setAutoPin(shelfId, autoPin) {
    const shelf = this.data.shelves.find(s => s.id === shelfId);
    if (shelf) {
      shelf.autoPin = autoPin;
      shelf.updatedAt = Date.now();
      this._save();
    }
    return shelf || null;
  }

  getShelf(shelfId) {
    return this.data.shelves.find(s => s.id === shelfId) || null;
  }

  getShelves() {
    return this.data.shelves;
  }

  getDeletedShelfIds() {
    return this.data.deletedShelfIds;
  }

  getDefaultShelfId() {
    const general = this.data.shelves.find(s => s.name === 'General');
    return general ? general.id : (this.data.shelves[0]?.id || '');
  }

  // --- Remote shelf sync ---

  /** Apply a single shelf-created from a peer. Returns true if added. */
  applyRemoteShelfCreated(shelf) {
    if (this.data.deletedShelfIds.includes(shelf.id)) return false;
    if (this.data.shelves.find(s => s.id === shelf.id)) return false;
    this.data.shelves.push({ ...shelf });
    this._save();
    return true;
  }

  /** Apply a shelf-updated from a peer. Returns true if changed. */
  applyRemoteShelfUpdated(shelfId, updates) {
    const shelf = this.data.shelves.find(s => s.id === shelfId);
    if (!shelf) return false;
    if (updates.name !== undefined) shelf.name = updates.name;
    if (updates.autoPin !== undefined) shelf.autoPin = updates.autoPin;
    if (updates.updatedAt !== undefined) shelf.updatedAt = updates.updatedAt;
    this._save();
    return true;
  }

  /** Apply a shelf-deleted from a peer. Returns true if it existed. */
  applyRemoteShelfDeleted(shelfId) {
    const existed = this.data.shelves.some(s => s.id === shelfId);
    this.data.shelves = this.data.shelves.filter(s => s.id !== shelfId);
    this.data.files = this.data.files.filter(f => f.shelfId !== shelfId);
    if (!this.data.deletedShelfIds.includes(shelfId)) {
      this.data.deletedShelfIds.push(shelfId);
    }
    this._save();
    return existed;
  }

  /** Full sync: merge a peer's shelf list + their deleted IDs. Returns true if anything changed. */
  mergeRemoteShelves(remoteShelves, remoteDeletedIds = []) {
    let changed = false;

    // 1. Apply remote deletions locally
    for (const id of remoteDeletedIds) {
      const idx = this.data.shelves.findIndex(s => s.id === id);
      if (idx !== -1) {
        this.data.shelves.splice(idx, 1);
        this.data.files = this.data.files.filter(f => f.shelfId !== id);
        changed = true;
      }
      if (!this.data.deletedShelfIds.includes(id)) {
        this.data.deletedShelfIds.push(id);
        changed = true;
      }
    }

    // 2. Add/update shelves from remote (skip tombstoned)
    for (const remote of remoteShelves) {
      if (this.data.deletedShelfIds.includes(remote.id)) continue;

      const local = this.data.shelves.find(s => s.id === remote.id);
      if (!local) {
        // Check for duplicate by name (e.g., both devices created "General" independently)
        const localByName = this.data.shelves.find(s => s.name === remote.name);
        if (localByName) {
          // Keep the older one's ID, retire the newer one
          const localTime = localByName.updatedAt || localByName.createdAt;
          const remoteTime = remote.updatedAt || remote.createdAt;
          if (remoteTime < localTime) {
            // Remote is older — adopt its ID, migrate our files
            const oldId = localByName.id;
            localByName.id = remote.id;
            localByName.createdAt = remote.createdAt;
            localByName.updatedAt = remote.updatedAt;
            localByName.createdBy = remote.createdBy;
            for (const f of this.data.files) {
              if (f.shelfId === oldId) f.shelfId = remote.id;
            }
          }
          // Either way, don't add as a new shelf
          changed = true;
          continue;
        }
        this.data.shelves.push({ ...remote });
        changed = true;
      } else {
        // Update if remote is newer
        const remoteTime = remote.updatedAt || remote.createdAt;
        const localTime = local.updatedAt || local.createdAt;
        if (remoteTime > localTime) {
          local.name = remote.name;
          local.autoPin = remote.autoPin;
          local.updatedAt = remote.updatedAt;
          changed = true;
        }
      }
    }

    if (changed) this._save();
    return changed;
  }

  // --- Files ---

  addFile(shelfId, fileEntry) {
    // fileEntry: { id, name, size, mimeType, localPath, thumbnail, deviceId, deviceName }
    const entry = {
      id: fileEntry.id,
      name: fileEntry.name,
      size: fileEntry.size,
      mimeType: fileEntry.mimeType,
      deviceId: fileEntry.deviceId,
      deviceName: fileEntry.deviceName,
      addedAt: Date.now(),
      shelfId,
      localPath: fileEntry.localPath || null,
      thumbnail: fileEntry.thumbnail || null,
      pinned: null, // null = use shelf default
    };
    this.data.files.push(entry);
    this._save();
    return entry;
  }

  removeFile(fileId) {
    this.data.files = this.data.files.filter(f => f.id !== fileId);
    this._save();
  }

  getFiles(shelfId) {
    return this.data.files.filter(f => f.shelfId === shelfId);
  }

  getAllLocalFiles() {
    return this.data.files.filter(f => f.deviceId === this.deviceId);
  }

  getFile(fileId) {
    return this.data.files.find(f => f.id === fileId) || null;
  }

  // --- Pin ---

  pinFile(fileId) {
    const file = this.data.files.find(f => f.id === fileId);
    if (file) {
      file.pinned = true;
      this._save();
    }
  }

  unpinFile(fileId) {
    const file = this.data.files.find(f => f.id === fileId);
    if (file) {
      file.pinned = false;
      this._save();
    }
  }

  clearPin(fileId) {
    const file = this.data.files.find(f => f.id === fileId);
    if (file) {
      file.pinned = null;
      this._save();
    }
  }

  // --- Migration from v1 uploads dir ---

  migrateFromUploadsDir(uploadsDir) {
    if (!fs.existsSync(uploadsDir)) return;
    const generalId = this.getDefaultShelfId();
    if (!generalId) return;

    const existingIds = new Set(this.data.files.map(f => f.id));
    try {
      const files = fs.readdirSync(uploadsDir);
      for (const filename of files) {
        const sepIdx = filename.indexOf('__');
        if (sepIdx === -1) continue;
        const fileId = filename.substring(0, sepIdx);
        if (existingIds.has(fileId)) continue; // already migrated

        const originalName = filename.substring(sepIdx + 2);
        const filePath = path.join(uploadsDir, filename);
        const stat = fs.statSync(filePath);
        const ext = path.extname(originalName).toLowerCase();

        const mimeMap = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
          '.mp4': 'video/mp4', '.pdf': 'application/pdf', '.txt': 'text/plain',
        };

        this.addFile(generalId, {
          id: fileId,
          name: originalName,
          size: stat.size,
          mimeType: mimeMap[ext] || 'application/octet-stream',
          localPath: filePath, // point to the uploads copy (legacy)
          thumbnail: null, // will be generated on demand
          deviceId: this.deviceId,
          deviceName: require('os').hostname(),
        });
      }
    } catch (err) {
      console.error('[ShelfStore] Migration error:', err.message);
    }
  }
}

module.exports = { ShelfStore };
