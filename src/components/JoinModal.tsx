// src/components/JoinModal.tsx
'use client';
import { useState } from 'react';

export default function JoinModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('');

  const handleSubmit = () => {
    if (code.length === 4 && /^\d{4}$/.test(code)) {
      window.location.href = `/join?code=${code}`;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🔗</div>
          <h3 style={{ margin: '0 0 6px', fontSize: 20 }}>加入服务</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
            输入服务发起者提供的 4 位数字码
          </p>
        </div>

        <input
          className="input"
          type="text"
          inputMode="numeric"
          maxLength={4}
          placeholder="输入 4 位数字码"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          autoFocus
          style={{ textAlign: 'center', fontSize: 28, fontWeight: 700, letterSpacing: 12, padding: '14px 16px' }}
        />

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={onClose} style={{ flex: 1 }}>
            取消
          </button>
          <button
            className="btn btn-primary"
            disabled={code.length !== 4}
            onClick={handleSubmit}
            style={{ flex: 1 }}
          >
            加入
          </button>
        </div>
      </div>
    </div>
  );
}
