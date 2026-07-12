// Join page — client logic
const params = new URLSearchParams(location.search);
const code = params.get('code');

let ws = null;
let serviceId = null;
let allowUpload = false;
let files = [];
let allFolders = [];
let currentPath = '';  // current navigation path, '' = root
let username = '';
let heartbeat = null;
let reconnect = null;
let intentionalLeave = false;
let recoveryPollTimer = null;
const RECOVERY_POLL_INTERVAL = 3000;
const RECOVERY_TIMEOUT = 60000;

// Download state: tracks in-progress downloads
let activeDownload = null;     // { downloadId, name, size, totalChunks }
let pendingPreview = null;     // { fileId, downloadId, type: 'image'|'pdf' } — set by previewFile
let previewOverridden = false; // true when showDownloadReady is temporarily overridden

function showState(name) {
  ['lookup', 'notfound', 'username', 'connected'].forEach(s => {
    document.getElementById(`state-${s}`).classList.toggle('hidden', s !== name);
  });
}

// ── Init ──

if (!code || !/^\d{4}$/.test(code)) {
  showState('notfound');
  document.getElementById('notfound-msg').textContent = '加入码格式不正确';
} else {
  document.getElementById('lookup-code').textContent = code;
  lookupService();
}

async function lookupService() {
  try {
    const data = await api(`/api/service/${code}`);
    if (data.found) {
      serviceId = data.serviceId;
      allowUpload = data.allowUpload;
      document.getElementById('uname-code').textContent = code;
      document.getElementById('uname-capacity').textContent =
        `在线 ${data.currentUsers || 0}/${data.maxUsers || 10} 人`;
      showState('username');
      setupUsernameForm();
    } else {
      showState('notfound');
    }
  } catch {
    showState('notfound');
    document.getElementById('notfound-msg').textContent = '网络错误，请刷新重试';
  }
}

// ── Username form ──

function setupUsernameForm() {
  const input = document.getElementById('username-input');
  const errorEl = document.getElementById('uname-error');
  const joinBtn = document.getElementById('btn-join-svc');

  joinBtn.addEventListener('click', join);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join();
  });

  function join() {
    username = input.value.trim();
    if (!username) {
      errorEl.textContent = '请输入昵称';
      errorEl.classList.remove('hidden');
      return;
    }
    if (username.length > 20) {
      errorEl.textContent = '昵称不能超过 20 个字符';
      errorEl.classList.remove('hidden');
      return;
    }
    errorEl.classList.add('hidden');
    joinBtn.disabled = true;
    joinBtn.textContent = '连接中...';

    connectWebSocket();
  }
}

// ── WebSocket ──

function connectWebSocket(isRetry) {
  if (ws) {
    try { ws.close(); } catch {}
  }

  updateConnectionStatus('connecting');
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', code, username }));
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
        console.log('[Join] heartbeat timeout');
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
    // Clean up active download UI
    activeDownload = null;
    document.getElementById('download-progress-area').classList.add('hidden');
    if (intentionalLeave) {
      if (recoveryPollTimer) { clearInterval(recoveryPollTimer); recoveryPollTimer = null; }
      return;
    }

    const isConnected = !document.getElementById('state-connected').classList.contains('hidden');

    if (!isConnected) {
      updateConnectionStatus('disconnected');
      showToast('连接失败，请重试', 'error');
      document.getElementById('btn-join-svc').disabled = false;
      document.getElementById('btn-join-svc').textContent = '加入';
      return;
    }

    updateConnectionStatus('recovering');
    startRecoveryPolling();
  };

  ws.onerror = () => {};
}

// ── Message handler ──

function handleMessage(msg) {
  console.log('[JOIN] recv:', msg.type, msg);

  switch (msg.type) {
    case 'joined':
      serviceId = msg.serviceId;
      showState('connected');
      updateConnectionStatus('connected');
      document.getElementById('conn-code').textContent = code;
      console.log('[JOIN] allowUpload =', allowUpload);
      if (allowUpload) { console.log('[JOIN] calling setupUpload'); setupUpload(); }
      else { console.log('[JOIN] upload not allowed — setupUpload skipped'); document.getElementById('upload-area').innerHTML = '<span class="text-xs text-gray-400">上传未启用</span>'; }
      break;

    case 'chat-message':
      addChatMessage(msg);
      break;

    case 'file-list':
      console.log('[JOIN] file-list received, count:', (msg.files || []).length);
      files = msg.files || [];
      allFolders = msg.folders || [];
      renderFiles();
      break;

    case 'download-progress':
      // Server → Joiner: chunk transfer progress update
      updateDownloadProgress(msg);
      break;

    case 'download-ready':
      // Server → Joiner: file is ready for HTTP download
      showDownloadReady(msg);
      break;

    case 'file-response':
      // Small file: direct transfer (backward compatible, server passes through)
      (() => {
        const blob = new Blob([base64ToArrayBuffer(msg.data)], { type: msg.mime });
        triggerDownload(blob, msg.name);
      })();
      break;

    case 'upload-error':
      console.error('[JOIN] upload-error:', msg.message);
      showToast(`上传失败: ${msg.message}`, 'error');
      break;

    case 'file-uploaded':
      console.log('[JOIN] file-uploaded received:', msg.name);
      showToast(`${msg.userName} 上传了 ${msg.name}`, 'success');
      break;

    case 'user-joined':
    case 'user-left':
      break;

    case 'host-left':
      intentionalLeave = true;
      showToast('主机已断开，正在等待服务恢复...', 'error');
      updateConnectionStatus('recovering');
      startRecoveryPolling();
      break;

    case 'kicked':
      intentionalLeave = true;
      showToast('你已被移出服务', 'error');
      setTimeout(() => { location.href = '/'; }, 2000);
      break;

    case 'error':
      console.error('[JOIN] server error:', msg.message);
      showToast(msg.message, 'error');
      break;

    default:
      console.log('[JOIN] unhandled message type:', msg.type, msg);
      break;
  }
}

// ── File list rendering ──

/**
 * Get direct child folders of the given path from the allFolders list.
 * e.g. for path='' with folders=['docs','docs/sub','images'] → ['docs','images']
 * e.g. for path='docs' with folders=['docs','docs/sub','docs/deep'] → ['docs/sub','docs/deep'] → direct: ['sub','deep']
 */
function getChildFolders(parentPath) {
  const prefix = parentPath ? parentPath + '/' : '';
  const children = new Set();
  for (const folder of allFolders) {
    if (folder === parentPath || !folder.startsWith(prefix)) continue;
    const relative = folder.substring(prefix.length);
    const slashIdx = relative.indexOf('/');
    if (slashIdx === -1) {
      children.add(relative);
    } else {
      children.add(relative.substring(0, slashIdx));
    }
  }
  return [...children].sort((a, b) => a.localeCompare(b));
}

function navigateTo(targetPath) {
  currentPath = targetPath;
  renderFiles();
}

function renderBreadcrumb() {
  const bcEl = document.getElementById('breadcrumb-nav');
  if (!currentPath) {
    bcEl.innerHTML = '<span class="text-xs text-gray-500 font-medium">📂 根目录</span>';
    return;
  }
  const parts = currentPath.split('/');
  let html = '<span class="text-xs text-gray-400 cursor-pointer hover:text-blue-600 breadcrumb-link" data-path="">📂 根目录</span>';
  let accumulated = '';
  for (const part of parts) {
    accumulated = accumulated ? `${accumulated}/${part}` : part;
    html += ` <span class="text-xs text-gray-300">/</span> <span class="text-xs text-gray-500 font-medium cursor-pointer hover:text-blue-600 breadcrumb-link" data-path="${accumulated}">${part}</span>`;
  }
  bcEl.innerHTML = html;

  // Attach click handlers
  bcEl.querySelectorAll('.breadcrumb-link').forEach(el => {
    el.addEventListener('click', () => navigateTo(el.dataset.path));
  });
}

function renderFiles() {
  const container = document.getElementById('join-file-list');
  const navArea = document.getElementById('folder-nav-area');

  // Update breadcrumb
  renderBreadcrumb();

  // Get files in current path and child folders
  const pathFiles = files.filter(f => f.fileId.lastIndexOf('/') === -1
    ? currentPath === ''
    : f.fileId.substring(0, f.fileId.lastIndexOf('/')) === currentPath);
  const childFolders = getChildFolders(currentPath);

  // Show/hide navigation area
  if (currentPath || childFolders.length > 0) {
    navArea.classList.remove('hidden');
  }

  if (!pathFiles.length && !childFolders.length) {
    container.innerHTML = '<p class="text-gray-400 text-sm">此文件夹为空</p>';
    return;
  }

  let html = '';

  // ".." back to parent
  if (currentPath) {
    const parentPath = currentPath.includes('/')
      ? currentPath.substring(0, currentPath.lastIndexOf('/'))
      : '';
    html += `<div class="flex items-center gap-3 py-2.5 border-b border-gray-100 cursor-pointer hover:bg-gray-50 rounded folder-entry" data-path="${parentPath}">
      <span class="text-lg">📁</span>
      <span class="flex-1 text-sm text-blue-600 font-medium">..</span>
      <span class="text-xs text-gray-400">返回上级</span>
    </div>`;
  }

  // Child folders
  for (const folderName of childFolders) {
    const fullPath = currentPath ? `${currentPath}/${folderName}` : folderName;
    const fileCount = files.filter(f => {
      const lastSlash = f.fileId.lastIndexOf('/');
      const fp = lastSlash === -1 ? '' : f.fileId.substring(0, lastSlash);
      return fp === fullPath || fp.startsWith(fullPath + '/');
    }).length;
    html += `<div class="flex items-center gap-3 py-2.5 border-b border-gray-100 cursor-pointer hover:bg-blue-50 rounded folder-entry" data-path="${fullPath}">
      <span class="text-lg">📁</span>
      <span class="flex-1 text-sm text-gray-700 font-medium">${folderName}/</span>
      <span class="text-xs text-gray-400">${fileCount} 个文件</span>
    </div>`;
  }

  // Files in current path
  for (const f of pathFiles) {
    html += joinFileRowHtml(f);
  }

  container.innerHTML = html;

  // Attach folder click handlers
  container.querySelectorAll('.folder-entry').forEach(el => {
    el.addEventListener('click', () => navigateTo(el.dataset.path));
  });

  // Attach download handlers
  container.querySelectorAll('.download-btn').forEach(btn => {
    btn.addEventListener('click', () => requestFile(btn.dataset.fileid));
  });

  // Attach preview handlers
  container.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', () => previewFile(btn.dataset.fileid));
  });
}

function joinFileRowHtml(f) {
  return `<div class="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
    <span class="text-lg">${(f.mime || '').startsWith('image/') ? '🖼' : '📄'}</span>
    <span class="flex-1 text-sm text-gray-700 truncate" title="${f.fileId}">${f.name}</span>
    <span class="text-xs text-gray-400">${formatSize(f.size)}</span>
    ${(f.mime || '').startsWith('image/') || f.name.endsWith('.pdf')
      ? `<button class="btn btn-outline text-xs px-2 py-1 preview-btn" data-fileid="${f.fileId}">预览</button>`
      : ''}
    <button class="btn btn-primary text-xs px-2 py-1 download-btn" data-fileid="${f.fileId}">下载</button>
  </div>`;
}

// ── File download ──

function requestFile(fileId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast('连接已断开，请刷新页面重试', 'error');
    return;
  }
  // Show immediate feedback
  const file = files.find(f => f.fileId === fileId);
  const area = document.getElementById('download-progress-area');
  const nameEl = document.getElementById('dl-progress-name');
  const textEl = document.getElementById('dl-progress-text');
  const bar = document.getElementById('dl-progress-bar');
  const link = document.getElementById('dl-ready-link');
  area.classList.remove('hidden');
  link.classList.add('hidden');
  bar.style.width = '0%';
  bar.className = 'bg-blue-500 h-2.5 rounded-full';
  nameEl.textContent = '📥 ' + (file ? file.name : fileId);
  textEl.textContent = '正在请求文件...';
  console.log('[JOIN] requesting file:', fileId);
  ws.send(JSON.stringify({ type: 'file-request', fileId, requestId: crypto.randomUUID(), userName: username }));
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`已下载 ${name}`, 'success');
}

// ── Download progress (server-buffered HTTP download) ──

function updateDownloadProgress(msg) {
  // Don't show progress area during preview (modal has its own spinner)
  if (pendingPreview) return;

  const area = document.getElementById('download-progress-area');
  const nameEl = document.getElementById('dl-progress-name');
  const textEl = document.getElementById('dl-progress-text');
  const bar = document.getElementById('dl-progress-bar');
  const link = document.getElementById('dl-ready-link');

  area.classList.remove('hidden');
  link.classList.add('hidden');

  activeDownload = { downloadId: msg.downloadId, name: msg.name, size: msg.size, totalChunks: msg.total };

  const pct = msg.total > 0 ? Math.round((msg.received / msg.total) * 100) : 0;
  nameEl.textContent = '📥 ' + msg.name;
  textEl.textContent = `传输中 ${msg.received}/${msg.total} 块 · ${pct}%`;
  bar.style.width = pct + '%';
  bar.className = 'bg-blue-500 h-2.5 rounded-full transition-all duration-300';
}

function showDownloadReady(msg) {
  // If a preview is pending for this download, handle it first
  if (pendingPreview) {
    if (pendingPreview.type === 'image') {
      const content = document.getElementById('preview-content');
      const img = new Image();
      img.src = `/api/dl/${encodeURIComponent(msg.downloadId)}`;
      img.className = 'max-w-full max-h-[70vh] rounded';
      img.onload = () => { content.innerHTML = ''; content.appendChild(img); };
      img.onerror = () => { content.innerHTML = '<p class="text-red-500">预览加载失败</p>'; };
    } else if (pendingPreview.type === 'pdf') {
      const content = document.getElementById('preview-content');
      content.innerHTML = `<iframe src="/api/dl/${encodeURIComponent(msg.downloadId)}" class="w-full h-[70vh] rounded"></iframe>`;
    }
    pendingPreview = null;
    document.getElementById('download-progress-area').classList.add('hidden');
    activeDownload = null;
    return;
  }

  // Normal download flow: show download button
  const area = document.getElementById('download-progress-area');
  const nameEl = document.getElementById('dl-progress-name');
  const textEl = document.getElementById('dl-progress-text');
  const bar = document.getElementById('dl-progress-bar');
  const link = document.getElementById('dl-ready-link');

  area.classList.remove('hidden');
  bar.style.width = '100%';
  bar.className = 'bg-green-500 h-2.5 rounded-full transition-all duration-300';
  nameEl.textContent = '✅ ' + msg.name;
  textEl.textContent = `${formatSize(msg.size)} — 点击下方按钮下载`;
  link.href = `/api/dl/${encodeURIComponent(msg.downloadId)}`;
  link.classList.remove('hidden');
  link.textContent = `⬇ 下载 ${msg.name} (${formatSize(msg.size)})`;

  activeDownload = null;
}

// ── File preview ──

function previewFile(fileId) {
  const file = files.find(f => f.fileId === fileId);
  if (!file) return;

  const modal = document.getElementById('preview-modal');
  const content = document.getElementById('preview-content');
  modal.classList.remove('hidden');

  if ((file.mime || '').startsWith('image/')) {
    content.innerHTML = `<div class="text-center text-gray-400 py-10"><div class="spinner mx-auto mb-3"></div>加载预览中...</div>`;
    pendingPreview = { fileId, type: 'image' };
    requestFile(fileId);
  } else if (file.name.endsWith('.pdf')) {
    content.innerHTML = `<div class="text-center text-gray-400 py-10"><div class="spinner mx-auto mb-3"></div>加载预览中...</div>`;
    pendingPreview = { fileId, type: 'pdf' };
    requestFile(fileId);
  } else {
    content.innerHTML = '<p class="text-gray-500">此文件类型不支持预览</p>';
  }
}

document.getElementById('preview-close').addEventListener('click', () => {
  document.getElementById('preview-modal').classList.add('hidden');
  document.getElementById('preview-content').innerHTML = '';
  pendingPreview = null; // Cancel any pending preview
});

// ── File upload ──

function setupUpload() {
  console.log('[JOIN] setupUpload called');
  const area = document.getElementById('upload-area');
  area.innerHTML = `
    <input id="file-input" type="file" class="hidden">
    <button id="btn-select-file" class="btn btn-outline text-sm">选择文件</button>
    <button id="btn-upload-file" class="btn btn-primary text-sm ml-2 hidden">上传</button>
    <span id="upload-name" class="text-xs text-gray-500 ml-2 hidden"></span>
  `;

  let selectedFile = null;

  document.getElementById('btn-select-file').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  document.getElementById('file-input').addEventListener('change', (e) => {
    selectedFile = e.target.files[0];
    console.log('[JOIN] file selected:', selectedFile ? selectedFile.name : 'none');
    if (selectedFile) {
      document.getElementById('upload-name').textContent = selectedFile.name;
      document.getElementById('upload-name').classList.remove('hidden');
      document.getElementById('btn-upload-file').classList.remove('hidden');
    }
  });

  document.getElementById('btn-upload-file').addEventListener('click', async () => {
    console.log('[JOIN] upload clicked, ws.readyState:', ws ? ws.readyState : 'no ws', 'selectedFile:', !!selectedFile);
    if (!selectedFile || !ws) { console.log('[JOIN] upload aborted — no file or no ws'); return; }
    if (ws.readyState !== WebSocket.OPEN) { console.log('[JOIN] upload aborted — ws not open'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = arrayBufferToBase64(reader.result);
      console.log('[JOIN] sending file-upload:', { name: selectedFile.name, mime: selectedFile.type, dataLen: base64.length, path: currentPath });
      ws.send(JSON.stringify({
        type: 'file-upload',
        name: selectedFile.name,
        mime: selectedFile.type || 'application/octet-stream',
        data: base64,
        userName: username,
        path: currentPath || '',
      }));
      showToast(`正在上传 ${selectedFile.name}...`, 'success');
      document.getElementById('upload-name').classList.add('hidden');
      document.getElementById('btn-upload-file').classList.add('hidden');
      selectedFile = null;
    };
    reader.onerror = () => { console.error('[JOIN] FileReader error:', reader.error); };
    reader.readAsArrayBuffer(selectedFile);
  });
}

// ── Connection status ──

function updateConnectionStatus(state) {
  const statusEl = document.getElementById('connection-status');
  const headerStatusEl = document.getElementById('header-status');
  const restoreBtn = document.getElementById('btn-restore');

  if (state === 'connected') {
    headerStatusEl.classList.add('hidden');
    statusEl.classList.remove('hidden');
    statusEl.textContent = '🟢 已连接';
    statusEl.className = 'text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700';
    restoreBtn.classList.add('hidden');
  } else if (state === 'connecting') {
    headerStatusEl.classList.add('hidden');
    statusEl.classList.remove('hidden');
    statusEl.textContent = '🟡 连接中...';
    statusEl.className = 'text-xs font-medium px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-700';
    restoreBtn.classList.add('hidden');
  } else if (state === 'recovering') {
    headerStatusEl.classList.add('hidden');
    statusEl.classList.remove('hidden');
    statusEl.textContent = '🔄 等待主机恢复...';
    statusEl.className = 'text-xs font-medium px-2.5 py-1 rounded-full bg-blue-100 text-blue-700';
    restoreBtn.classList.add('hidden');
  } else if (state === 'disconnected') {
    headerStatusEl.classList.add('hidden');
    statusEl.classList.remove('hidden');
    statusEl.textContent = '🔴 已断开';
    statusEl.className = 'text-xs font-medium px-2.5 py-1 rounded-full bg-red-100 text-red-700';
    restoreBtn.classList.remove('hidden');
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
    from: username,
    time,
  }));

  input.value = '';
}

// ── Service recovery polling ──

function startRecoveryPolling() {
  if (recoveryPollTimer) clearInterval(recoveryPollTimer);

  const startTime = Date.now();
  let attemptCount = 0;

  recoveryPollTimer = setInterval(async () => {
    attemptCount++;
    const elapsed = Date.now() - startTime;

    if (elapsed > RECOVERY_TIMEOUT) {
      clearInterval(recoveryPollTimer);
      recoveryPollTimer = null;
      updateConnectionStatus('disconnected');
      showToast('服务未恢复，请稍后重试', 'error');
      return;
    }

    try {
      const data = await api(`/api/service/${code}`);
      if (data.found) {
        // Service is back! Rejoin
        clearInterval(recoveryPollTimer);
        recoveryPollTimer = null;
        console.log('[JOIN] Service recovered, rejoining...');
        updateConnectionStatus('connecting');
        connectWebSocket(true);
      } else {
        console.log(`[JOIN] Recovery poll attempt ${attemptCount} — service not found yet`);
      }
    } catch {
      console.warn(`[JOIN] Recovery poll attempt ${attemptCount} — network error`);
    }
  }, RECOVERY_POLL_INTERVAL);
}

// ── Restore button ──

document.getElementById('btn-restore').addEventListener('click', () => {
  if (recoveryPollTimer) { clearInterval(recoveryPollTimer); recoveryPollTimer = null; }
  updateConnectionStatus('recovering');
  startRecoveryPolling();
});

// ── Leave ──

document.getElementById('btn-leave').addEventListener('click', () => {
  intentionalLeave = true;
  if (heartbeat) heartbeat.stop();
  if (reconnect) reconnect.cancel();
  if (recoveryPollTimer) { clearInterval(recoveryPollTimer); recoveryPollTimer = null; }
  if (ws) ws.close();
  location.href = '/';
});
