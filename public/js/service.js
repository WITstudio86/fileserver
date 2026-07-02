// Service page — host logic
const params = new URLSearchParams(location.search);
const token = params.get('token');

let ws = null;
let serviceId = null;
let serviceCode = null;
let dirHandle = null;
let files = [];
let heartbeat = null;
let reconnect = null;
let filePollTimer = null;
let intentionalLeave = false;

// ── State transitions ──

function showState(name) {
  ['validating', 'invalid', 'configuring', 'active'].forEach(s => {
    document.getElementById(`state-${s}`).classList.toggle('hidden', s !== name);
  });
}

// ── Initialize ──

if (!token) {
  showState('invalid');
  document.getElementById('invalid-msg').textContent = '缺少服务令牌，请从首页开启服务';
} else {
  init();
}

async function init() {
  try {
    const data = await api(`/api/token/status/${token}`);
    if (data.status === 'unused') {
      showState('configuring');
      setupConfigForm();
    } else if (data.status === 'used') {
      serviceCode = data.code;
      showState('active');
      document.getElementById('header-badge').textContent = '运行中';
      document.getElementById('header-badge').className = 'text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700';
      if (data.code) document.getElementById('active-code').textContent = data.code;
      document.getElementById('active-dir').textContent = '(刷新后需重新选择目录)';
      document.getElementById('btn-pick-dir').classList.remove('hidden');
      setupPickDirButton();
      connectWebSocket(data.code);
    } else {
      showState('invalid');
      document.getElementById('invalid-msg').textContent = '令牌已过期';
    }
  } catch {
    showState('invalid');
    document.getElementById('invalid-msg').textContent = '网络错误，请刷新重试';
  }
}

// ── Config form ──

function setupConfigForm() {
  const codeInput = document.getElementById('cfg-code');
  const maxUsersInput = document.getElementById('cfg-max-users');
  const allowUploadCheck = document.getElementById('cfg-allow-upload');
  const pickDirBtn = document.getElementById('cfg-pick-dir');
  const dirNameEl = document.getElementById('cfg-dir-name');
  const saveBtn = document.getElementById('cfg-save');
  const errorEl = document.getElementById('cfg-error');

  pickDirBtn.addEventListener('click', async () => {
    try {
      dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const perm = await dirHandle.requestPermission({ mode: 'readwrite' });
      console.log('[Host] directory permission:', perm);
      dirNameEl.textContent = '已选：' + dirHandle.name;
      dirNameEl.classList.remove('hidden');
      checkConfig();
    } catch (e) {
      console.error('[Host] directory picker error:', e);
      // user cancelled or denied
    }
  });

  codeInput.addEventListener('input', checkConfig);
  function checkConfig() {
    const code = codeInput.value.trim();
    saveBtn.disabled = !(/^\d{4}$/.test(code) && dirHandle);
  }

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = '创建中...';
    errorEl.classList.add('hidden');

    try {
      const regData = await api('/api/service/register', {
        method: 'POST',
        body: JSON.stringify({
          token,
          code: codeInput.value.trim(),
          maxUsers: parseInt(maxUsersInput.value) || 10,
          allowUpload: allowUploadCheck.checked,
          sharePath: dirHandle.name,
        }),
      });

      if (regData.error) {
        errorEl.textContent = regData.error;
        errorEl.classList.remove('hidden');
        saveBtn.disabled = false;
        saveBtn.textContent = '保存并启动';
        return;
      }

      serviceId = regData.serviceId;
      await api('/api/service/start', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });

      showState('active');
      document.getElementById('header-badge').textContent = '运行中';
      document.getElementById('header-badge').className = 'text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700';
      serviceCode = codeInput.value.trim();
      document.getElementById('active-code').textContent = serviceCode;
      document.getElementById('active-dir').textContent = dirHandle.name;

      connectWebSocket(serviceCode);
    } catch {
      errorEl.textContent = '网络错误，请重试';
      errorEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = '保存并启动';
    }
  });
}

// ── WebSocket ──

function connectWebSocket(code, isRetry) {
  if (ws) {
    try { ws.close(); } catch {}
  }

  updateConnectionStatus('connecting');
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'register', code: code || '', token }));
    // Start heartbeat
    if (heartbeat) heartbeat.stop();
    heartbeat = createHeartbeat({
      pingInterval: 15000,
      timeout: 45000,
      onPing: () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      },
      onTimeout: () => {
        console.log('[Host] heartbeat timeout');
        if (ws) { try { ws.close(); } catch {} }
      },
    });
    heartbeat.start();
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'pong') {
      heartbeat.reset();
      return;
    }
    handleMessage(msg);
  };

  ws.onclose = () => {
    if (heartbeat) heartbeat.stop();
    if (filePollTimer) { clearInterval(filePollTimer); filePollTimer = null; }

    if (intentionalLeave) return;

    updateConnectionStatus('disconnected');

    if (reconnect) reconnect.cancel();
    reconnect = createReconnect({
      delays: [2000, 4000, 8000],
      onReconnect: () => {
        updateConnectionStatus('connecting');
        connectWebSocket(serviceCode, true);
      },
      onFailed: () => {
        updateConnectionStatus('disconnected');
        showToast('连接失败，请点击恢复按钮重试', 'error');
      },
    });
    reconnect.start();
  };

  ws.onerror = () => {};
}

// ── Message handler ──

function handleMessage(msg) {
  console.log('[WS host] recv', msg.type);

  switch (msg.type) {
    case 'joined':
      serviceId = msg.serviceId;
      updateConnectionStatus('connected');
      fetchActivityLogs();
      readDirectory();
      startFilePolling();
      break;

    case 'user-joined':
      addUser(msg.user);
      refreshUserList();
      // Re-send file list so new joiner gets it
      broadcastFileList();
      break;

    case 'user-left':
      removeUser(msg.userId);
      refreshUserList();
      break;

    case 'file-request':
      handleFileRequest(msg);
      break;

    case 'file-upload':
      handleFileUpload(msg);
      break;

    case 'chat-message':
      addChatMessage(msg);
      break;

    case 'host-left':
      break;

    case 'error':
      showToast(msg.message, 'error');
      break;
  }
}

// ── Directory reading ──

async function readDirectory() {
  if (!dirHandle) {
    console.warn('[Host] readDirectory skipped: dirHandle is null. Host must select a directory first.');
    document.getElementById('active-dir').textContent = '请先选择目录';
    return;
  }
  files = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      const f = await entry.getFile();
      files.push({
        fileId: entry.name,
        name: entry.name,
        size: f.size,
        lastModified: f.lastModified,
        mime: f.type || 'application/octet-stream',
        handle: entry,
      });
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  renderHostFiles();

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'file-list', files: files.map(f => ({ fileId: f.fileId, name: f.name, size: f.size, mime: f.mime })) }));
  }
}

function broadcastFileList() {
  if (files.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'file-list', files: files.map(f => ({ fileId: f.fileId, name: f.name, size: f.size, mime: f.mime })) }));
  }
}

async function pickAndReadDir() {
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await dirHandle.requestPermission({ mode: 'readwrite' });
    document.getElementById('active-dir').textContent = dirHandle.name;
    await readDirectory();
  } catch {
    // user cancelled or permission denied
  }
}

let pickDirButtonReady = false;

function setupPickDirButton() {
  if (pickDirButtonReady) return;
  pickDirButtonReady = true;
  document.getElementById('btn-pick-dir').addEventListener('click', pickAndReadDir);
}

function renderHostFiles() {
  const container = document.getElementById('host-file-list');
  if (!files.length) {
    container.innerHTML = '<p class="text-gray-400 text-sm">目录为空</p>';
    return;
  }
  container.innerHTML = files.map(f => `
    <div class="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
      <span class="text-lg">${f.mime.startsWith('image/') ? '🖼' : '📄'}</span>
      <span class="flex-1 text-sm text-gray-700 truncate" title="${f.name}">${f.name}</span>
      <span class="text-xs text-gray-400">${formatSize(f.size)}</span>
    </div>
  `).join('');
}

// ── File request handler ──

async function handleFileRequest(msg) {
  const file = files.find(f => f.fileId === msg.fileId);
  if (!file || !ws) return;

  try {
    const data = await file.handle.getFile();
    const buffer = await data.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'file-response',
      fileId: msg.fileId,
      name: file.name,
      mime: file.mime,
      data: base64,
    }));
  } catch (e) {
    console.error('File read error:', e);
  }
}

// ── File upload handler ──

async function handleFileUpload(msg) {
  console.log('[Host] handleFileUpload called, msg:', { name: msg.name, mime: msg.mime, dataLen: msg.data ? msg.data.length : 0, dirHandle: !!dirHandle });
  if (!dirHandle) {
    console.error('[Host] No dirHandle — host needs to select directory first');
    showToast('未选择共享目录，请先选择目录', 'error');
    document.getElementById('active-dir').innerHTML = '<span class="text-red-500 font-bold">请先点击「选择目录」按钮</span>';
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'upload-error', name: msg.name, userName: msg.userName, message: 'Host 未选择共享目录' }));
    }
    return;
  }

  try {
    const buffer = base64ToArrayBuffer(msg.data);
    const fileName = msg.name;
    console.log('[Host] Writing file:', fileName, 'size:', buffer.byteLength);
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(buffer);
    await writable.close();
    console.log('[Host] File written, re-reading directory...');

    await readDirectory();

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'file-uploaded', name: msg.name, userName: msg.userName || 'Unknown' }));
    }
    console.log('[Host] file-uploaded sent');
  } catch (e) {
    console.error('[Host] File write error:', e);
    showToast('文件写入失败: ' + e.message, 'error');
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'upload-error', name: msg.name, userName: msg.userName, message: e.message }));
    }
  }
}

// ── User management ──

let users = [];

function addUser(user) {
  if (!users.find(u => u.userId === user.userId)) {
    users.push(user);
  }
}

function removeUser(userId) {
  users = users.filter(u => u.userId !== userId);
}

function refreshUserList() {
  const container = document.getElementById('user-list');
  const logFilter = document.getElementById('log-filter');

  if (!users.length) {
    container.innerHTML = '<p class="text-gray-400 text-sm">等待加入...</p>';
  } else {
    container.innerHTML = users.map(u => `
      <div class="flex items-center gap-2 py-1.5">
        <span class="w-2 h-2 rounded-full bg-green-400"></span>
        <span class="text-sm text-gray-700">${u.username}</span>
      </div>
    `).join('');
  }

  // Update log filter dropdown
  logFilter.innerHTML = '<option value="">全部</option>' +
    users.map(u => `<option value="${u.username}">${u.username}</option>`).join('');
}

// ── Activity log ──

async function fetchActivityLogs(userName) {
  if (!serviceId) return;
  try {
    const data = await api(`/api/logs/${serviceId}?token=${token}${userName ? '&user=' + userName : ''}`);
    renderActivityLog(data.logs || []);
  } catch {}
}

function renderActivityLog(logs) {
  const container = document.getElementById('activity-log');
  if (!logs.length) {
    container.innerHTML = '<p class="text-gray-400 text-sm">暂无记录</p>';
    return;
  }
  container.innerHTML = logs.map(l => {
    const time = new Date(l.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const actionMap = { joined: '加入', left: '离开', kicked: '被踢出', downloaded: '下载', uploaded: '上传', previewed: '预览' };
    const actionLabel = actionMap[l.action] || l.action;
    return `<div class="flex items-center gap-2 text-xs text-gray-600">
      <span class="text-gray-400 w-12 shrink-0">${time}</span>
      <span class="font-medium">${l.userName}</span>
      <span>${actionLabel}</span>
      ${l.detail ? `<span class="text-gray-400 truncate flex-1">${l.detail}</span>` : ''}
    </div>`;
  }).join('');
}

// ── Close service ──

document.getElementById('btn-close').addEventListener('click', async () => {
  if (!confirm('确定要关闭服务吗？所有加入者将被断开。')) return;
  try {
    await api('/api/service/close', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    if (ws) {
      ws.send(JSON.stringify({ type: 'close' }));
      ws.close();
    }
    location.href = '/';
  } catch {}
});

// ── Log filter ──

document.getElementById('log-filter').addEventListener('change', function () {
  fetchActivityLogs(this.value || null);
});

// ── Connection status ──

function updateConnectionStatus(state) {
  const badge = document.getElementById('header-badge');
  const statusEl = document.getElementById('connection-status');
  const restoreBtn = document.getElementById('btn-restore');

  if (state === 'connected') {
    badge.classList.add('hidden');
    statusEl.classList.remove('hidden');
    statusEl.textContent = '🟢 已连接';
    statusEl.className = 'text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700';
    restoreBtn.classList.add('hidden');
  } else if (state === 'connecting') {
    badge.classList.add('hidden');
    statusEl.classList.remove('hidden');
    statusEl.textContent = '🟡 连接中...';
    statusEl.className = 'text-xs font-medium px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-700';
    restoreBtn.classList.add('hidden');
  } else if (state === 'disconnected') {
    badge.classList.add('hidden');
    statusEl.classList.remove('hidden');
    statusEl.textContent = '🔴 已断开';
    statusEl.className = 'text-xs font-medium px-2.5 py-1 rounded-full bg-red-100 text-red-700';
    restoreBtn.classList.remove('hidden');
  } else {
    // Other badge states from existing logic
    statusEl.classList.add('hidden');
    restoreBtn.classList.add('hidden');
    badge.classList.remove('hidden');
  }
}

// ── File polling ──

function startFilePolling() {
  if (filePollTimer) return;
  filePollTimer = setInterval(pollDirectory, 10000);
}

async function pollDirectory() {
  if (!dirHandle || !serviceId) return;

  try {
    // Read current directory state
    const currentFiles = [];
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        const f = await entry.getFile();
        currentFiles.push({
          fileId: entry.name,
          name: entry.name,
          size: f.size,
          lastModified: f.lastModified,
          mime: f.type || 'application/octet-stream',
          handle: entry,
        });
      }
    }

    // Build comparable lists
    const oldMeta = files.map(f => ({ name: f.name, size: f.size, lastModified: f.lastModified || 0 }));
    const newMeta = currentFiles.map(f => ({ name: f.name, size: f.size, lastModified: f.lastModified }));

    const diff = computeFileDiff(oldMeta, newMeta);

    // Only act if there are changes
    if (diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0) {
      // Update file cache
      files = currentFiles;
      files.sort((a, b) => a.name.localeCompare(b.name));
      renderHostFiles();

      // Broadcast new file list
      if (ws && ws.readyState === WebSocket.OPEN) {
        broadcastFileList();
      }

      // Build detailed log message
      const parts = [];
      if (diff.added.length) parts.push('新增: ' + diff.added.map(f => f.name).join(', '));
      if (diff.removed.length) parts.push('删除: ' + diff.removed.map(f => f.name).join(', '));
      if (diff.modified.length) parts.push('修改: ' + diff.modified.map(f => f.name).join(', '));

      // Log the change
      try {
        await api(`/api/logs/${serviceId}`, {
          method: 'POST',
          body: JSON.stringify({
            token,
            action: 'file-updated',
            detail: '文件列表已更新：' + parts.join('; '),
            userName: '系统',
          }),
        });
        fetchActivityLogs(document.getElementById('log-filter').value || null);
      } catch {}
    }
  } catch (e) {
    console.warn('[Host] file polling error:', e);
  }
}

// ── Chat ──

function addChatMessage(msg) {
  const container = document.getElementById('chat-messages');
  const isFirst = container.querySelector('.text-gray-400') !== null;

  if (isFirst) container.innerHTML = '';

  const msgEl = document.createElement('div');
  msgEl.className = 'flex items-start gap-2 text-sm';
  msgEl.innerHTML = `
    <span class="text-xs text-gray-400 shrink-0 mt-0.5">${msg.time || ''}</span>
    <span class="font-medium text-gray-600 shrink-0">${msg.from}:</span>
    <span class="text-gray-700 break-all">${msg.text}</span>
    <button class="copy-btn shrink-0 text-gray-400 hover:text-gray-600 text-xs px-1" title="复制">📋</button>
  `;

  const copyBtn = msgEl.querySelector('.copy-btn');
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(msg.text).then(() => {
      copyBtn.textContent = '✓';
      setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
    }).catch(() => {});
  });

  container.appendChild(msgEl);
  container.scrollTop = container.scrollHeight;
}

document.getElementById('chat-send').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

  const now = new Date();
  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  ws.send(JSON.stringify({
    type: 'chat-message',
    text,
    from: '我（主机）',
    time,
  }));

  input.value = '';
}

// ── Restore button ──

document.getElementById('btn-restore').addEventListener('click', () => {
  if (reconnect) reconnect.cancel();
  updateConnectionStatus('connecting');
  connectWebSocket(serviceCode, true);
});

// ── Intentional close (override) ──

const originalCloseBtn = document.getElementById('btn-close');
originalCloseBtn.addEventListener('click', () => {
  intentionalLeave = true;
  if (heartbeat) heartbeat.stop();
  if (reconnect) reconnect.cancel();
  if (filePollTimer) { clearInterval(filePollTimer); filePollTimer = null; }
});

// Poll activity logs every 10s
setInterval(() => { if (serviceId) fetchActivityLogs(document.getElementById('log-filter').value || null); }, 10000);
