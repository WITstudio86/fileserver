// src/components/ServiceConfig.tsx
'use client';
import { useState } from 'react';

interface Config {
  code: string;
  maxUsers: number;
  allowUpload: boolean;
  sharePath: string;
}

export default function ServiceConfig({ token, onConfigSaved }: {
  token: string;
  onConfigSaved: (cfg: Config) => void;
}) {
  const [code, setCode] = useState('');
  const [maxUsers, setMaxUsers] = useState(10);
  const [allowUpload, setAllowUpload] = useState(false);
  const [sharePath, setSharePath] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSelectDir = async () => {
    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      if (dirHandle.requestPermission) {
        const perm = await dirHandle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          alert('需要写入权限才能接收上传文件');
        }
      }
      setSharePath(dirHandle.name);
      (window as any).__shareDirHandle = dirHandle;
    } catch { /* user cancelled */ }
  };

  const handleSave = async () => {
    if (code.length !== 4 || !/^\d{4}$/.test(code)) {
      setError('请输入 4 位数字码'); return;
    }
    if (!sharePath) {
      setError('请选择共享目录'); return;
    }
    setSaving(true);
    setError('');
    const res = await fetch('/api/service/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, code, maxUsers, allowUpload, sharePath }),
    });
    const data = await res.json();
    if (data.error) {
      setError(data.error);
    } else {
      onConfigSaved({ code, maxUsers, allowUpload, sharePath });
    }
    setSaving(false);
  };

  return (
    <div className="card" style={{ maxWidth: 460, margin: '40px auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>⚙️</div>
        <h2 style={{ fontSize: 22, margin: 0 }}>服务配置</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
          设置 4 位码和共享目录后即可开启服务
        </p>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 6 }}>
          4 位数字码
        </label>
        <input
          className="input"
          type="text"
          inputMode="numeric"
          maxLength={4}
          placeholder="例如：1234"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          style={{ textAlign: 'center', fontSize: 24, fontWeight: 700, letterSpacing: 8, padding: '12px 16px' }}
          autoFocus
        />
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
          其他人通过此 4 位码加入你的服务
        </p>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 6 }}>
          人数上限
        </label>
        <input
          className="input"
          type="number"
          min={1}
          max={50}
          value={maxUsers}
          onChange={(e) => setMaxUsers(Number(e.target.value))}
          style={{ width: 100 }}
        />
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 10,
          cursor: 'pointer', fontSize: 14, fontWeight: 500,
          padding: '10px 14px', borderRadius: 8,
          background: allowUpload ? '#eff6ff' : '#f9fafb',
          border: allowUpload ? '1.5px solid #bfdbfe' : '1.5px solid var(--border)',
          transition: 'all 0.15s',
        }}>
          <input
            type="checkbox"
            checked={allowUpload}
            onChange={(e) => setAllowUpload(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
          />
          <div>
            <div>允许加入者上传文件</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>
              开启后，加入者可以向你的共享目录上传文件
            </div>
          </div>
        </label>
      </div>

      <div style={{ marginBottom: 24 }}>
        <button
          className="btn btn-secondary"
          onClick={handleSelectDir}
          style={{ width: '100%', justifyContent: 'flex-start', padding: '14px 16px', fontSize: 14 }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          {sharePath ? `已选择：${sharePath}` : '选择共享目录'}
        </button>
        {sharePath && (
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
            ✅ 目录已就绪，文件将在此目录中共享
          </p>
        )}
      </div>

      {error && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: 8, padding: '10px 14px', marginBottom: 16,
          color: '#dc2626', fontSize: 14,
        }}>
          {error}
        </div>
      )}

      <button
        className="btn btn-primary"
        onClick={handleSave}
        disabled={saving}
        style={{ width: '100%', padding: '14px', fontSize: 16 }}
      >
        {saving ? '⏳ 保存中...' : '保存配置并开启服务'}
      </button>
    </div>
  );
}
