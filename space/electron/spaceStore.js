const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SpaceStore {
  constructor(dataDir, deviceId) {
    this.dataDir = dataDir;
    this.deviceId = deviceId;
    this.filePath = path.join(dataDir, 'space-data.json');
    this.data = { spaces: [], files: [], deletedSpaceIds: [] };
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      this.data = JSON.parse(raw);
      if (!Array.isArray(this.data.spaces)) this.data.spaces = [];
      if (!Array.isArray(this.data.files)) this.data.files = [];
      if (!Array.isArray(this.data.deletedSpaceIds)) this.data.deletedSpaceIds = [];
    } catch {
      this.data = { spaces: [], files: [], deletedSpaceIds: [] };
    }
  }

  _save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('[SpaceStore] Failed to save:', err.message);
    }
  }

  // --- Init ---

  /** Ensure a "General" space exists on first launch */
  ensureDefaults() {
    if (this.data.spaces.length === 0) {
      this.createSpace('General', true);
    }
  }

  // --- Space CRUD ---

  createSpace(name, autoPin = true) {
    const now = Date.now();
    const space = {
      id: crypto.randomBytes(6).toString('hex'),
      name,
      createdAt: now,
      updatedAt: now,
      createdBy: this.deviceId,
      autoPin,
    };
    this.data.spaces.push(space);
    this._save();
    return space;
  }

  deleteSpace(spaceId) {
    this.data.spaces = this.data.spaces.filter(s => s.id !== spaceId);
    this.data.files = this.data.files.filter(f => f.spaceId !== spaceId);
    if (!this.data.deletedSpaceIds.includes(spaceId)) {
      this.data.deletedSpaceIds.push(spaceId);
    }
    this._save();
  }

  renameSpace(spaceId, name) {
    const space = this.data.spaces.find(s => s.id === spaceId);
    if (space) {
      space.name = name;
      space.updatedAt = Date.now();
      this._save();
    }
    return space || null;
  }

  setAutoPin(spaceId, autoPin) {
    const space = this.data.spaces.find(s => s.id === spaceId);
    if (space) {
      space.autoPin = autoPin;
      space.updatedAt = Date.now();
      this._save();
    }
    return space || null;
  }

  getSpace(spaceId) {
    return this.data.spaces.find(s => s.id === spaceId) || null;
  }

  getSpaces() {
    return this.data.spaces;
  }

  getDeletedSpaceIds() {
    return this.data.deletedSpaceIds;
  }

  getDefaultSpaceId() {
    const general = this.data.spaces.find(s => s.name === 'General');
    return general ? general.id : (this.data.spaces[0]?.id || '');
  }

  // --- Remote space sync ---

  /** Apply a single space-created from a peer. Returns true if added. */
  applyRemoteSpaceCreated(space) {
    if (this.data.deletedSpaceIds.includes(space.id)) return false;
    if (this.data.spaces.find(s => s.id === space.id)) return false;
    this.data.spaces.push({ ...space });
    this._save();
    return true;
  }

  /** Apply a space-updated from a peer. Returns true if changed. */
  applyRemoteSpaceUpdated(spaceId, updates) {
    const space = this.data.spaces.find(s => s.id === spaceId);
    if (!space) return false;
    if (updates.name !== undefined) space.name = updates.name;
    if (updates.autoPin !== undefined) space.autoPin = updates.autoPin;
    if (updates.updatedAt !== undefined) space.updatedAt = updates.updatedAt;
    this._save();
    return true;
  }

  /** Apply a space-deleted from a peer. Returns true if it existed. */
  applyRemoteSpaceDeleted(spaceId) {
    const existed = this.data.spaces.some(s => s.id === spaceId);
    this.data.spaces = this.data.spaces.filter(s => s.id !== spaceId);
    this.data.files = this.data.files.filter(f => f.spaceId !== spaceId);
    if (!this.data.deletedSpaceIds.includes(spaceId)) {
      this.data.deletedSpaceIds.push(spaceId);
    }
    this._save();
    return existed;
  }

  /** Full sync: merge a peer's space list + their deleted IDs. Returns true if anything changed. */
  mergeRemoteSpaces(remoteSpaces, remoteDeletedIds = []) {
    let changed = false;

    // 1. Apply remote deletions locally
    for (const id of remoteDeletedIds) {
      const idx = this.data.spaces.findIndex(s => s.id === id);
      if (idx !== -1) {
        this.data.spaces.splice(idx, 1);
        this.data.files = this.data.files.filter(f => f.spaceId !== id);
        changed = true;
      }
      if (!this.data.deletedSpaceIds.includes(id)) {
        this.data.deletedSpaceIds.push(id);
        changed = true;
      }
    }

    // 2. Add/update spaces from remote (skip tombstoned)
    for (const remote of remoteSpaces) {
      if (this.data.deletedSpaceIds.includes(remote.id)) continue;

      const local = this.data.spaces.find(s => s.id === remote.id);
      if (!local) {
        // Check for duplicate by name (e.g., both devices created "General" independently)
        const localByName = this.data.spaces.find(s => s.name === remote.name);
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
              if (f.spaceId === oldId) f.spaceId = remote.id;
            }
          }
          // Either way, don't add as a new space
          changed = true;
          continue;
        }
        this.data.spaces.push({ ...remote });
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

  addFile(spaceId, fileEntry) {
    // fileEntry: { id, name, size, mimeType, localPath, thumbnail, deviceId, deviceName }
    const entry = {
      id: fileEntry.id,
      name: fileEntry.name,
      size: fileEntry.size,
      mimeType: fileEntry.mimeType,
      deviceId: fileEntry.deviceId,
      deviceName: fileEntry.deviceName,
      addedAt: Date.now(),
      spaceId,
      localPath: fileEntry.localPath || null,
      thumbnail: fileEntry.thumbnail || null,
      pinned: null, // null = use space default
    };
    this.data.files.push(entry);
    this._save();
    return entry;
  }

  removeFile(fileId) {
    this.data.files = this.data.files.filter(f => f.id !== fileId);
    this._save();
  }

  getFiles(spaceId) {
    return this.data.files.filter(f => f.spaceId === spaceId);
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
    const generalId = this.getDefaultSpaceId();
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
      console.error('[SpaceStore] Migration error:', err.message);
    }
  }
}

module.exports = { SpaceStore };
