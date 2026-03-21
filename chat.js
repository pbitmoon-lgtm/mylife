// ═══════════════════════════════════════════════════════
// My Life — chat.js  v1.0
// Chat locale cifrata + infrastruttura P2P
//
// ARCHITETTURA:
//   Conversazioni salvate cifrate in IndexedDB (tipo 'conversation')
//   Messaggi salvati cifrati (tipo 'message')
//   Contatti identificati da publicKey (derivata dal seed)
//   Condivisione contatto via QR code / link
//   P2P via WebRTC (segnalazione manuale MVP, poi Nostr M1.3)
// ═══════════════════════════════════════════════════════

import State from './state.js';
import UI    from './ui.js';

const ChatModule = (() => {

  let _conversations = [];  // lista conversazioni
  let _activeChatId  = null;
  let _messages      = [];  // messaggi della chat attiva
  let _myId          = null;// ID pubblico derivato dal seed

  // ─── INIT ─────────────────────────────────────────────
  State.subscribe('APP_READY', () => {
    console.log('[chat] modulo pronto');
    loadConversations();
  });

  // ─── CARICA CONVERSAZIONI ─────────────────────────────
  function loadConversations() {
    _conversations = [];
    State.dispatch('INTENT_LOAD_RECORDS', {
      type: 'conversation', requestId: 'chat_convs'
    });
  }

  State.subscribe('PAYLOAD_DECRYPTED', ({ id, payload, isAsset, requestId }) => {
    if (isAsset || !payload) return;
    if (requestId === 'chat_convs' && payload.type === 'conversation') {
      _conversations.push({ ...payload, id });
      renderConvList();
    }
    if (requestId === 'chat_msgs' && payload.type === 'message') {
      _messages.push({ ...payload, id });
      renderMessages();
    }
  });

  State.subscribe('RECORDS_LOAD_STARTED', ({ requestId, count }) => {
    if (requestId === 'chat_convs' && count === 0) renderConvList();
    if (requestId === 'chat_msgs' && count === 0) renderMessages();
  });

  // ─── RENDER LISTA CONVERSAZIONI ───────────────────────
  function renderConvList() {
    const list = document.getElementById('chat-conv-list');
    if (!list) return;

    const sorted = [..._conversations].sort(
      (a,b) => (b.lastTs||b.id) - (a.lastTs||a.id)
    );

    if (!sorted.length) {
      list.innerHTML = `
        <div class="chat-empty">
          <div style="font-size:48px;opacity:.3;margin-bottom:16px">💬</div>
          <div style="font-size:15px;font-weight:600;opacity:.5">Nessuna conversazione</div>
          <div style="font-size:13px;color:var(--text2);margin-top:8px">
            Premi + per aggiungere un contatto
          </div>
        </div>`;
      return;
    }

    list.innerHTML = sorted.map(c => {
      const time = c.lastTs
        ? new Date(c.lastTs).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})
        : '';
      const unread = c.unread || 0;
      return `<div class="chat-conv-item" onclick="ChatModule.openChat(${c.id})">
        <div class="chat-avatar">${(c.name||'?')[0].toUpperCase()}</div>
        <div class="chat-conv-info">
          <div class="chat-conv-head">
            <div class="chat-conv-name">${UI.esc(c.name||'Contatto')}</div>
            <div class="chat-conv-time">${time}</div>
          </div>
          <div class="chat-conv-preview">
            ${unread ? `<span class="chat-unread-badge">${unread}</span>` : ''}
            ${UI.esc(c.lastMsg||'Nessun messaggio')}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  // ─── APRI CHAT ────────────────────────────────────────
  function openChat(convId) {
    _activeChatId = convId;
    _messages = [];
    const conv = _conversations.find(c => c.id === convId);
    if (!conv) return;

    // Header
    const nameEl = document.getElementById('chat-active-name');
    const statusEl = document.getElementById('chat-active-status');
    if (nameEl) nameEl.textContent = conv.name || 'Contatto';
    if (statusEl) statusEl.textContent = conv.online ? '● Online' : 'Offline';

    document.getElementById('chat-list-view')?.classList.add('hidden');
    document.getElementById('chat-active-view')?.classList.remove('hidden');

    // Carica messaggi
    State.dispatch('INTENT_LOAD_RECORDS', {
      type: 'message', requestId: 'chat_msgs'
    });

    // Azzera unread
    if (conv.unread) {
      conv.unread = 0;
      State.dispatch('INTENT_SAVE_RECORD', {
        recordId: conv.id, type: 'conversation', textPayload: conv
      });
    }
  }

  function closeChat() {
    _activeChatId = null;
    document.getElementById('chat-list-view')?.classList.remove('hidden');
    document.getElementById('chat-active-view')?.classList.add('hidden');
  }

  // ─── RENDER MESSAGGI ──────────────────────────────────
  function renderMessages() {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    // Filtra messaggi della conversazione attiva
    const msgs = _messages
      .filter(m => m.convId === _activeChatId)
      .sort((a,b) => a.ts - b.ts);

    if (!msgs.length) {
      container.innerHTML = `
        <div style="text-align:center;color:var(--text2);padding:40px 20px;font-size:13px">
          Nessun messaggio.<br>Inizia la conversazione!
        </div>`;
      return;
    }

    let lastDate = '';
    container.innerHTML = msgs.map(m => {
      const d     = new Date(m.ts);
      const date  = d.toLocaleDateString('it-IT',{day:'numeric',month:'short'});
      const time  = d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
      const isMe  = m.senderId === 'me';
      const dateDivider = date !== lastDate
        ? `<div class="chat-date-divider">${date}</div>`
        : '';
      lastDate = date;

      return `${dateDivider}
        <div class="chat-bubble-wrap ${isMe ? 'me' : 'them'}">
          <div class="chat-bubble ${isMe ? 'me' : 'them'}">
            ${m.type === 'image'
              ? `<img src="${m.content}" class="chat-img" onclick="ChatModule.viewImg(this.src)">`
              : UI.esc(m.content||'')}
          </div>
          <div class="chat-time">${time}${isMe ? (m.read ? ' ✓✓' : ' ✓') : ''}</div>
        </div>`;
    }).join('');

    // Scrolla in fondo
    container.scrollTop = container.scrollHeight;
  }

  // ─── INVIA MESSAGGIO ──────────────────────────────────
  async function sendMsg() {
    const inp = document.getElementById('chat-input');
    if (!inp) return;
    const text = inp.value.trim();
    if (!text || !_activeChatId) return;

    inp.value = '';
    inp.style.height = 'auto';

    const msg = {
      id:       Date.now(),
      type:     'message',
      convId:   _activeChatId,
      senderId: 'me',
      content:  text,
      ts:       Date.now(),
      read:     false,
    };

    State.dispatch('INTENT_SAVE_RECORD', {
      recordId: msg.id, type: 'message', textPayload: msg
    });

    _messages.push(msg);
    renderMessages();

    // Aggiorna ultimo messaggio nella conversazione
    const conv = _conversations.find(c => c.id === _activeChatId);
    if (conv) {
      conv.lastMsg = text;
      conv.lastTs  = msg.ts;
      State.dispatch('INTENT_SAVE_RECORD', {
        recordId: conv.id, type: 'conversation', textPayload: conv
      });
    }

    // TODO M1.3: invia via WebRTC/Nostr
    // _sendP2P(msg);
  }

  // ─── INVIA IMMAGINE ───────────────────────────────────
  async function sendImage(inp) {
    const file = inp.files[0];
    if (!file || !_activeChatId) return;
    const src = await UI.resize(file, 800);
    const msg = {
      id:       Date.now(),
      type:     'message',
      convId:   _activeChatId,
      senderId: 'me',
      content:  src,
      msgType:  'image',
      ts:       Date.now(),
      read:     false,
    };
    State.dispatch('INTENT_SAVE_RECORD', {
      recordId: msg.id, type: 'message', textPayload: msg
    });
    _messages.push(msg);
    renderMessages();
    inp.value = '';
  }

  function viewImg(src) {
    const overlay = document.getElementById('chat-img-overlay');
    const img     = document.getElementById('chat-img-full');
    if (overlay && img) { img.src = src; overlay.classList.add('open'); }
  }

  function closeImg() {
    document.getElementById('chat-img-overlay')?.classList.remove('open');
  }

  // ─── NUOVO CONTATTO ───────────────────────────────────
  function openAddContact() {
    document.getElementById('chat-add-panel')?.classList.add('open');
    document.getElementById('chat-add-name')?.focus();
  }

  function closeAddContact() {
    document.getElementById('chat-add-panel')?.classList.remove('open');
    const n = document.getElementById('chat-add-name');
    const k = document.getElementById('chat-add-key');
    if (n) n.value = '';
    if (k) k.value = '';
  }

  function saveContact() {
    const name = document.getElementById('chat-add-name')?.value.trim();
    const key  = document.getElementById('chat-add-key')?.value.trim();
    if (!name) { document.getElementById('chat-add-name')?.focus(); return; }

    const id   = Date.now();
    const conv = {
      id, type:'conversation',
      name, publicKey: key || null,
      createdAt: Date.now(), lastTs: null, lastMsg: '', unread: 0,
    };

    State.dispatch('INTENT_SAVE_RECORD', {
      recordId: id, type: 'conversation', textPayload: conv
    });
    _conversations.unshift(conv);
    renderConvList();
    closeAddContact();
  }

  // ─── MY ID / QR ───────────────────────────────────────
  function showMyId() {
    const panel = document.getElementById('chat-myid-panel');
    if (!panel) return;
    const idEl  = document.getElementById('chat-my-pubkey');
    if (idEl) idEl.textContent = _myId || 'Genera un account prima';
    panel.classList.add('open');
  }

  function closeMyId() {
    document.getElementById('chat-myid-panel')?.classList.remove('open');
  }

  function copyMyId() {
    const id = _myId;
    if (!id) return;
    navigator.clipboard?.writeText(id).then(() => {
      const btn = document.getElementById('chat-copy-btn');
      if (btn) { btn.textContent = '✓ Copiato!'; setTimeout(() => btn.textContent = 'Copia ID', 2000); }
    });
  }

  // Resize textarea automatico
  function onInputChange(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }

  // Invio con Enter (Shift+Enter = nuova riga)
  function onInputKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMsg();
    }
  }

  // API pubblica
  const pub = {
    loadConversations, openChat, closeChat,
    sendMsg, sendImage, viewImg, closeImg,
    openAddContact, closeAddContact, saveContact,
    showMyId, closeMyId, copyMyId,
    onInputChange, onInputKeydown,
  };
  window.ChatModule = pub;
  return pub;

})();

export default ChatModule;
