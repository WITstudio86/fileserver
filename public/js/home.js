// Home page logic
document.getElementById('btn-host').addEventListener('click', async () => {
  const btn = document.getElementById('btn-host');
  btn.disabled = true;
  btn.textContent = '创建中...';
  try {
    const data = await api('/api/token/create', { method: 'POST' });
    location.href = `/service?token=${data.token}`;
  } catch (e) {
    showToast('创建失败，请重试', 'error');
    btn.disabled = false;
    btn.textContent = '开启服务';
  }
});

document.getElementById('btn-join').addEventListener('click', () => {
  const { overlay } = createModal(`
    <h2 class="text-lg font-semibold text-gray-800 mb-4">加入服务</h2>
    <p class="text-sm text-gray-500 mb-3">请输入服务端的 4 位加入码</p>
    <input id="join-code-input" class="input text-center text-2xl tracking-widest" type="text" maxlength="4" placeholder="0000" autofocus>
    <p id="join-error" class="text-red-500 text-sm mt-2 hidden"></p>
    <div class="flex justify-end gap-2 mt-4">
      <button id="join-cancel" class="btn btn-outline">取消</button>
      <button id="join-confirm" class="btn btn-primary">加入</button>
    </div>
  `);

  const input = document.getElementById('join-code-input');
  const error = document.getElementById('join-error');
  const confirmBtn = document.getElementById('join-confirm');

  document.getElementById('join-cancel').addEventListener('click', () => overlay.remove());
  confirmBtn.addEventListener('click', () => handleJoin());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleJoin();
  });
  // Auto-submit on 4 digits
  input.addEventListener('input', () => {
    if (input.value.length === 4) handleJoin();
  });

  async function handleJoin() {
    const code = input.value.trim();
    if (!/^\d{4}$/.test(code)) {
      error.textContent = '请输入 4 位数字';
      error.classList.remove('hidden');
      return;
    }
    error.classList.add('hidden');
    confirmBtn.disabled = true;
    confirmBtn.textContent = '查找中...';
    try {
      const data = await api(`/api/service/${code}`);
      if (data.found) {
        location.href = `/join?code=${code}`;
      } else {
        error.textContent = '未找到该服务，请检查加入码是否正确';
        error.classList.remove('hidden');
        confirmBtn.disabled = false;
        confirmBtn.textContent = '加入';
      }
    } catch {
      error.textContent = '网络错误，请重试';
      error.classList.remove('hidden');
      confirmBtn.disabled = false;
      confirmBtn.textContent = '加入';
    }
  }
});
