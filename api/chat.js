// DOM Selectors
const list = document.getElementById('list');
const chat = document.getElementById('chat');
const input = document.getElementById('msg');
const sendBtn = document.getElementById('send');
const voiceBtn = document.getElementById('voiceBtn');
const fileInput = document.getElementById('fileInput');
const attachBtn = document.getElementById('attachBtn');
const attachPreview = document.getElementById('attachPreview');

// State Initialization
let messages = typeof Memory !== 'undefined' ? Memory.init([]) : [];
let attachments = [];
let isRecording = false;
let recognition = null;

// Utility: Format File Sizes
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Utility: Markdown Parsing
function mdToHtml(text) {
  if (!text) return '';
  let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.match(/\.(mp4|webm|mov)$/)) {
      return `<video src="${url}" controls playsinline></video>`;
    }
    return `<img src="${url}" alt="${alt}" loading="lazy">`;
  });

  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return html.split('\n').join('<br>');
}

// Scroll Handling
function scrollToBottom() {
  chat.scrollTop = chat.scrollHeight;
}

// UI Rendering: Chat Messages
function render() {
  list.innerHTML = '';
  
  messages.forEach(m => {
    if (!m.content && (!m.files || !m.files.length)) return;

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '8px';
    wrap.style.alignItems = m.role === 'user' ? 'flex-end' : 'flex-start';

    const bubble = document.createElement('div');
    bubble.className = `bubble ${m.role === 'user' ? 'user' : 'assistant'}`;
    bubble.innerHTML = mdToHtml(m.content || '');

    if (m.files && m.files.some(f => f.textContent)) {
      m.files.forEach(f => {
        if (f.textContent) {
          const pre = document.createElement('pre');
          pre.className = 'code';
          pre.textContent = `${f.name}\n\n${f.textContent.slice(0, 800)}`;
          bubble.appendChild(pre);
        }
      });
    }
    wrap.appendChild(bubble);

    if (m.files && m.files.length) {
      const filesDiv = document.createElement('div');
      filesDiv.className = 'files';
      m.files.forEach(f => {
        const a = document.createElement('a');
        a.className = 'file';
        a.href = f.url || '#';
        a.target = '_blank';
        a.innerHTML = `<span class="ext">${f.ext}</span><span class="name">${f.name}</span><span class="size">${f.size}${f.dataUrl ? ' • vision' : ''}</span>`;
        filesDiv.appendChild(a);
      });
      wrap.appendChild(filesDiv);
    }

    list.appendChild(wrap);
  });

  scrollToBottom();
  if (typeof Memory !== 'undefined') {
    try { Memory.save(messages); } catch (e) { console.error('Memory save error:', e); }
  }
}

// UI Rendering: Attached File Previews
function renderAttachments() {
  attachPreview.innerHTML = '';
  attachments.forEach(f => {
    const div = document.createElement('div');
    div.className = 'attach-card';
    div.innerHTML = `
      <span class="ext" style="font-size:11px;background:#212121;padding:3px 6px;border-radius:6px;color:#8e8e8e;font-weight:600">${f.ext}</span>
      <div style="display:flex;flex-direction:column">
        <span style="font-size:12px">${f.name}</span>
        <span style="font-size:11px;color:#6e6e6e">${f.size}${f.dataUrl ? ' • vision' : ''}</span>
      </div>
      <button data-id="${f.id}" style="background:transparent;border:0;color:#8e8e8e;cursor:pointer;font-size:16px;margin-left:8px">×</button>`;
    attachPreview.appendChild(div);
  });

  attachPreview.querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      const target = attachments.find(a => a.id == btn.dataset.id);
      if (target?.url) URL.revokeObjectURL(target.url);
      attachments = attachments.filter(a => a.id != btn.dataset.id);
      renderAttachments();
      updateSend();
    };
  });
}

// Toggle Send vs Voice Button Visibility
function updateSend() {
  const hasContent = input.value.trim() || attachments.length > 0;
  if (hasContent) {
    sendBtn.style.display = 'flex';
    sendBtn.classList.add('active');
    voiceBtn.style.display = 'none';
  } else {
    sendBtn.style.display = 'none';
    sendBtn.classList.remove('active');
    voiceBtn.style.display = 'flex';
  }
}

// Speech Recognition Toggle
function toggleVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert('Voice Speech Recognition is not supported on this browser.');
    return;
  }

  if (isRecording && recognition) {
    recognition.stop();
    return;
  }

  recognition = new SR();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.continuous = true;

  recognition.onstart = () => {
    isRecording = true;
    voiceBtn.style.background = '#ff3b30';
    voiceBtn.innerHTML = '<span style="width:12px;height:12px;background:white;border-radius:50%;display:inline-block;animation:pulse 1s infinite"></span>';
  };

  recognition.onend = () => {
    isRecording = false;
    voiceBtn.style.background = '#1a1a1a';
    voiceBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>';
    updateSend();
  };

  recognition.onresult = (e) => {
    let txt = '';
    for (let i = 0; i < e.results.length; i++) {
      txt += e.results[i][0].transcript;
    }
    input.value = txt;
    updateSend();
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  };

  recognition.onerror = (e) => {
    isRecording = false;
    voiceBtn.style.background = '#1a1a1a';
    alert('Mic error: ' + e.error);
  };

  try {
    recognition.start();
  } catch {
    alert('Please allow microphone permissions.');
  }
}

// Send Message Action
async function send() {
  if (isRecording && recognition) {
    recognition.stop();
  }

  const content = input.value.trim();
  if (!content && !attachments.length) return;

  const userFiles = [...attachments];
  messages.push({ role: 'user', content: content || '', files: userFiles, id: Date.now() });

  input.value = '';
  input.style.height = 'auto';
  attachments = [];
  renderAttachments();
  render();
  updateSend();

  messages.push({ role: 'assistant', content: '...', id: 'loading' });
  render();

  try {
    let finalContent = content || '';
    let imagePayloads = [];

    if (userFiles.length) {
      finalContent += "\n\n";
      userFiles.forEach(f => {
        if (f.isImage && f.dataUrl) {
          imagePayloads.push({ name: f.name, dataUrl: f.dataUrl });
          finalContent += `[Image: ${f.name}]\n`;
        } else if (f.textContent) {
          finalContent += `[File: ${f.name}]\n${f.textContent.slice(0, 800)}\n\n`;
        }
      });
    }

    const history = messages
      .filter(m => m.id !== 'loading')
      .slice(-8)
      .map(m => ({ role: m.role, content: String(m.content || '').slice(0, 500) }));

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [...history.slice(0, -1), { role: 'user', content: finalContent }],
        images: imagePayloads
      })
    });

    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error(raw || `Status ${res.status}`); }

    if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : data?.error?.message || JSON.stringify(data));
    if (!data.reply) throw new Error('No reply received from server.');

    messages = messages.filter(m => m.id !== 'loading');
    messages.push({ role: 'assistant', content: data.reply, id: Date.now() + 1 });

  } catch (e) {
    console.error(e);
    messages = messages.filter(m => m.id !== 'loading');
    messages.push({ role: 'assistant', content: 'Error: ' + (e.message || 'Unknown error occurred.'), id: Date.now() + 1 });
  }

  render();
}

// Event Listeners Initialization
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  updateSend();
});

attachBtn.onclick = () => fileInput.click();

fileInput.onchange = (e) => {
  Array.from(e.target.files || []).forEach(file => {
    const id = Date.now() + Math.random();
    const url = URL.createObjectURL(file);
    const ext = (file.name.split('.').pop() || 'FILE').toUpperCase();
    const size = formatSize(file.size);
    const obj = { id, name: file.name, type: file.type || ext, size, rawSize: file.size, url, ext, textContent: '', dataUrl: null, isImage: file.type.startsWith('image/') };

    if (file.size < 5 * 1024 * 1024) {
      if (obj.isImage) {
        const r = new FileReader();
        r.onload = ev => { obj.dataUrl = ev.target.result; renderAttachments(); updateSend(); };
        r.readAsDataURL(file);
      } else {
        const r = new FileReader();
        r.onload = ev => {
          try { obj.textContent = String(ev.target.result).slice(0, 1000); } catch {}
          renderAttachments(); updateSend();
        };
        r.readAsText(file);
      }
    }
    attachments.push(obj);
  });
  fileInput.value = '';
  renderAttachments();
  updateSend();
};

voiceBtn.onclick = toggleVoice;
sendBtn.onclick = send;

input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

// Run Initial Render
render();
