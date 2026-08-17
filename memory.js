// memory.js - Importable Chat Memory Module v1.0
// Works with any design - Clippy, Gelo AI, ICARE, etc.
// Usage: <script src="memory.js"></script> then Memory.init()

const Memory = {
  key: 'clippy_chat_memory',
  maxMessages: 100, // keep last 100 messages max to avoid storage limit
  maxStorageSize: 4 * 1024 * 1024, // 4MB safety limit

  // Load from localStorage
  load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      // Validate
      if (!Array.isArray(data) || data.length === 0) return null;
      console.log(`[Memory] Loaded ${data.length} messages from localStorage`);
      return data;
    } catch (e) {
      console.warn('[Memory] Failed to load:', e);
      return null;
    }
  },

  // Save to localStorage (with size check)
  save(messages) {
    try {
      // Keep only recent messages + strip large file URLs to save space
      const toSave = messages.slice(-this.maxMessages).map(m => ({
        role: m.role,
        content: m.content,
        id: m.id,
        // Save file metadata but not blob URLs (they expire)
        files: (m.files || []).map(f => ({
          name: f.name,
          size: f.size,
          ext: f.ext,
          textContent: (f.textContent || '').slice(0, 2000) // trim file content
        }))
      }));
      
      const json = JSON.stringify(toSave);
      if (json.length > this.maxStorageSize) {
        console.warn('[Memory] Too large, trimming...');
        // Trim more aggressively
        const trimmed = toSave.slice(-20);
        localStorage.setItem(this.key, JSON.stringify(trimmed));
      } else {
        localStorage.setItem(this.key, json);
      }
      console.log(`[Memory] Saved ${toSave.length} messages`);
    } catch (e) {
      // Quota exceeded - clear and save last 10
      console.warn('[Memory] Quota exceeded, clearing:', e);
      try {
        localStorage.removeItem(this.key);
        const last = messages.slice(-10).map(m => ({ role: m.role, content: m.content, id: m.id, files: [] }));
        localStorage.setItem(this.key, JSON.stringify(last));
      } catch {}
    }
  },

  // Clear memory
  clear() {
    localStorage.removeItem(this.key);
    console.log('[Memory] Cleared');
  },

  // Init - returns saved messages or null
  init(defaultMessages) {
    const saved = this.load();
    if (saved && saved.length > 1) {
      return saved;
    }
    return defaultMessages;
  }
};

// Auto-export for module systems
if (typeof module !== 'undefined') module.exports = Memory;
