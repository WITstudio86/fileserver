// Join page — client logic
const params = new URLSearchParams(location.search);
const code = params.get('code');

let ws = null;
let serviceId = null;
let allowUpload = false;
let files = [];
let username = '';

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

function connectWebSocket() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', code, username }));
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    if (document.getElementById('state-connected').classList.contains('hidden')) {
      showToast('连接失败，请重试', 'error');
      document.getElementById('btn-join-svc').disabled = false;
      document.getElementById('btn-join-svc').textContent = '加入';
    }
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
      document.getElementById('header-status').textContent = '已连接';
      document.getElementById('header-status').className = 'text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700';
      document.getElementById('conn-code').textContent = code;
      console.log('[JOIN] allowUpload =', allowUpload);
      if (allowUpload) { console.log('[JOIN] calling setupUpload'); setupUpload(); }
      else { console.log('[JOIN] upload not allowed — setupUpload skipped'); document.getElementById('upload-area').innerHTML = '<span class="text-xs text-gray-400">上传未启用</span>'; }
      break;

    case 'file-list':
      console.log('[JOIN] file-list received, count:', (msg.files || []).length);
      files = msg.files || [];
      renderFiles();
      break;

    case 'file-response':
      handleFileResponse(msg);
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
      showToast('服务已关闭', 'error');
      setTimeout(() => { location.href = '/'; }, 2000);
      break;

    case 'kicked':
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

function renderFiles() {
  const container = document.getElementById('join-file-list');
  if (!files.length) {
    container.innerHTML = '<p class="text-gray-400 text-sm">目录为空</p>';
    return;
  }
  container.innerHTML = files.map(f => `
    <div class="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <span class="text-lg">${(f.mime || '').startsWith('image/') ? '🖼' : '📄'}</span>
      <span class="flex-1 text-sm text-gray-700 truncate" title="${f.name}">${f.name}</span>
      <span class="text-xs text-gray-400">${formatSize(f.size)}</span>
      ${(f.mime || '').startsWith('image/') || f.name.endsWith('.pdf')
        ? `<button class="btn btn-outline text-xs px-2 py-1 preview-btn" data-fileid="${f.fileId}">预览</button>`
        : ''}
      <button class="btn btn-primary text-xs px-2 py-1 download-btn" data-fileid="${f.fileId}">下载</button>
    </div>
  `).join('');

  // Attach download handlers
  container.querySelectorAll('.download-btn').forEach(btn => {
    btn.addEventListener('click', () => requestFile(btn.dataset.fileid));
  });

  // Attach preview handlers
  container.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', () => previewFile(btn.dataset.fileid));
  });
}

// ── File download ──

function requestFile(fileId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'file-request', fileId, userName: username }));
}

function handleFileResponse(msg) {
  const blob = new Blob([base64ToArrayBuffer(msg.data)], { type: msg.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = msg.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`已下载 ${msg.name}`, 'success');
}

// ── File preview ──

function previewFile(fileId) {
  const file = files.find(f => f.fileId === fileId);
  if (!file) return;

  const modal = document.getElementById('preview-modal');
  const content = document.getElementById('preview-content');

  modal.classList.remove('hidden');

  if ((file.mime || '').startsWith('image/')) {
    content.innerHTML = `<div class="text-center text-gray-400 py-10">点击"下载"以预览图片</div>`;
    // For images we request the actual file data
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'file-request', fileId, userName: username }));
      // Temporarily override handleFileResponse for preview
      const origHandler = handleFileResponse;
      handleFileResponse = function (msg) {
        if (msg.fileId === fileId) {
          const blob = new Blob([base64ToArrayBuffer(msg.data)], { type: msg.mime });
          const url = URL.createObjectURL(blob);
          content.innerHTML = `<img src="${url}" alt="${msg.name}" class="max-w-full max-h-[70vh] rounded">`;
        }
        handleFileResponse = origHandler;
      };
    }
  } else if (file.name.endsWith('.pdf')) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'file-request', fileId, userName: username }));
      const origHandler = handleFileResponse;
      handleFileResponse = function (msg) {
        if (msg.fileId === fileId) {
          const blob = new Blob([base64ToArrayBuffer(msg.data)], { type: msg.mime });
          const url = URL.createObjectURL(blob);
          content.innerHTML = `<iframe src="${url}" class="w-full h-[70vh] rounded"></iframe>`;
        }
        handleFileResponse = origHandler;
      };
    }
  } else {
    content.innerHTML = '<p class="text-gray-500">此文件类型不支持预览</p>';
  }
}

document.getElementById('preview-close').addEventListener('click', () => {
  document.getElementById('preview-modal').classList.add('hidden');
  document.getElementById('preview-content').innerHTML = '';
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
      console.log('[JOIN] sending file-upload:', { name: selectedFile.name, mime: selectedFile.type, dataLen: base64.length });
      ws.send(JSON.stringify({
        type: 'file-upload',
        name: selectedFile.name,
        mime: selectedFile.type || 'application/octet-stream',
        data: base64,
        userName: username,
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

// ── Leave ──

document.getElementById('btn-leave').addEventListener('click', () => {
  if (ws) ws.close();
  location.href = '/';
});
