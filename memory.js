// memory.js - v3.0 SINGLE REPO - fetch + localStorage hybrid
const Memory = {
  key: 'clippy_chat_memory',
  longTermKey: 'clippy_long_term_memory',
  jsonFile: './memory.json',
  maxMessages: 100,
  cachedJson: null,

  // NEW: fetch memory.json (kaha data)
  async loadJson() {
    try {
      const res = await fetch(this.jsonFile + '?t=' + Date.now());
      if (!res.ok) throw new Error('no json');
      const data = await res.json();
      this.cachedJson = data;
      console.log('[Memory v3] Loaded memory.json ✅', data);
      return data;
    } catch (e) {
      console.log('[Memory v3] No memory.json, using localStorage', e);
      return this.loadLongTerm();
    }
  },

  // NEW: save to memory.json object + localStorage
  async saveJson(newKahaEntry) {
    try {
      if (!this.cachedJson) await this.loadJson();
      if (!this.cachedJson) this.cachedJson = {kaha:[], preferences:{}};
      if (newKahaEntry) {
        this.cachedJson.kaha = this.cachedJson.kaha || [];
        this.cachedJson.kaha.push(newKahaEntry);
      }
      // Save to localStorage as backup
      localStorage.setItem(this.longTermKey, JSON.stringify(this.cachedJson));
      console.log('[Memory v3] Saved to cache, now download memory.json manually');
      // Trigger download for you to commit to GitHub/Vercel
      this.downloadJson();
      return this.cachedJson;
    } catch(e) { console.error(e); }
  },

  downloadJson() {
    const blob = new Blob([JSON.stringify(this.cachedJson, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'memory.json';
    a.click();
  },

  load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!Array.isArray(data) || data.length === 0) return null;
      return data;
    } catch { return null; }
  },

  loadLongTerm() {
    try {
      const raw = localStorage.getItem(this.longTermKey);
      return raw? JSON.parse(raw) : {kaha:[]};
    } catch { return {kaha:[]}; }
  },

  saveLongTerm(key, value) {
    try {
      const data = this.loadLongTerm();
      data[key] = value;
      data._updated = new Date().toISOString();
      localStorage.setItem(this.longTermKey, JSON.stringify(data));
      this.cachedJson = data;
      return data;
    } catch(e) {}
  },

  extractPreferences(content) {
    if (!content) return null;
    const lower = content.toLowerCase();
    const prefs = this.loadLongTerm();
    let found = false;

    if (lower.includes('use') && lower.includes('instead of')) {
      const m = content.match(/use\s+(.+?)\s+instead of\s+(.+)/i);
      if (m) {
        const useWhat = m[1].trim().toLowerCase().replace(/buddy|please/g,'').trim();
        const insteadWhat = m[2].trim().toLowerCase().replace(/buddy|please/g,'').trim();
        prefs[`pref_${insteadWhat}`] = useWhat;
        prefs['language_style'] = `Use "${useWhat}" instead of "${insteadWhat}"`;
        prefs['later_not_tomorrow'] = true;
        found = true;
      }
    }
    if (lower.includes('tandaan mo') || lower.startsWith('remember')) {
      const fact = content.replace(/remember|tandaan mo/gi,'').trim().slice(0,200);
      if (fact.length > 5) { prefs[`fact_${Date.now()}`] = fact; found = true; }
    }
    if (lower.includes('my shift') || lower.includes('duty ko')) {
      prefs['last_schedule'] = content.slice(0,200);
      found = true;
    }
    if (found) {
      localStorage.setItem(this.longTermKey, JSON.stringify(prefs));
      this.cachedJson = prefs;
    }
    return found? prefs : null;
  },

  save(messages) {
    try {
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      if (lastUser) this.extractPreferences(lastUser.content);
      const toSave = messages.slice(-100).map(m => ({
        role: m.role, content: m.content, id: m.id,
        files: (m.files||[]).map(f=>({name:f.name,size:f.size,ext:f.ext,textContent:(f.textContent||'').slice(0,2000)}))
      }));
      localStorage.setItem(this.key, JSON.stringify(toSave));
    } catch {
      try {
        localStorage.setItem(this.key, JSON.stringify(messages.slice(-10).map(m=>({role:m.role,content:m.content,id:m.id,files:[]}))));
      } catch {}
    }
  },

  clear() {
    localStorage.removeItem(this.key);
    console.log('[Memory v3] Cleared chat only, long-term kept');
  },

  clearAll() {
    localStorage.removeItem(this.key);
    localStorage.removeItem(this.longTermKey);
  },

  async init(defaultMessages) {
    await this.loadJson(); // NEW: auto load memory.json
    const saved = this.load();
    const lt = this.loadLongTerm();
    if (lt.later_not_tomorrow) console.log('[Memory v3] Using later not tomorrow ✅');
    if (saved && saved.length > 1) return saved;
    return defaultMessages;
  }
};
