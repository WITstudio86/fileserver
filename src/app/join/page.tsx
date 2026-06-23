// src/app/join/page.tsx
'use client';
import { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import FileList from '@/components/FileList';
import type { WsServerMessage, FileMeta } from '@/lib/types';

function JoinContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code') || '';
  const [step, setStep] = useState<'lookup' | 'username' | 'connected' | 'notFound'>('lookup');
  const [username, setUsername] = useState('');
  const [serviceInfo, setServiceInfo] = useState<any>(null);
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [uploadMsg, setUploadMsg] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const usernameRef = useRef('');
  useEffect(() => { usernameRef.current = username; }, [username]);

  useEffect(() => {
    if (!code) { setStep('notFound'); return; }
    fetch(`/api/service/${code}`)
      .then(r => r.json())
      .then(data => {
        if (data.found) { setServiceInfo(data); setStep('username'); }
        else setStep('notFound');
      })
      .catch(() => setStep('notFound'));
  }, [code]);

  const requestFile = useCallback((fileId: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'file-request',
        fileId,
        userName: usernameRef.current,
      }));
    }
  }, []);

  const uploadFile = useCallback((name: string, mime: string, data: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'file-upload',
        name,
        mime,
        data,
        userName: usernameRef.current,
      }));
    }
  }, []);

  const handleJoin = () => {
    if (!username.trim()) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', code, username }));
    };

    ws.onmessage = (e) => {
      const msg: WsServerMessage = JSON.parse(e.data);
      console.log('[Joiner] WS recv:', msg.type, msg);
      switch (msg.type) {
        case 'joined':
          setStep('connected');
          break;
        case 'file-list':
          setFiles(msg.files);
          break;
        case 'file-response':
          downloadFile(msg.name, msg.mime, msg.data);
          break;
        case 'file-uploaded':
          setUploadMsg(`${msg.userName} 上传了 ${msg.name}`);
          setTimeout(() => setUploadMsg(''), 4000);
          break;
        case 'host-left':
        case 'kicked':
          setStep('notFound');
          break;
        case 'error':
          alert(msg.message);
          break;
      }
    };

    ws.onclose = () => setStep('notFound');
  };

  if (step === 'lookup') {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ color: 'var(--muted)' }}>查找服务中...</p>
      </div>
    );
  }

  if (step === 'notFound') {
    return (
      <>
        <Header />
        <div style={{ padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <p style={{ color: '#ef4444', fontSize: 18, fontWeight: 500, marginBottom: 16 }}>服务未找到或已关闭</p>
          <a href="/" className="btn btn-primary" style={{ display: 'inline-flex' }}>返回首页</a>
        </div>
      </>
    );
  }

  if (step === 'username') {
    return (
      <>
        <Header />
        <div className="card" style={{ maxWidth: 420, margin: '60px auto', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔗</div>
          <h2 style={{ marginBottom: 8, fontSize: 22 }}>加入服务</h2>
          <p style={{ color: 'var(--muted)', marginBottom: 24, fontSize: 14 }}>
            服务码：<strong style={{ fontSize: 20, letterSpacing: 4, color: 'var(--accent)' }}>{code}</strong>
            <br />
            <span style={{ fontSize: 13 }}>在线人数：{serviceInfo.currentUsers}/{serviceInfo.maxUsers}</span>
          </p>
          <input
            className="input"
            placeholder="输入你的昵称"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            autoFocus
            style={{ marginBottom: 16, textAlign: 'center' }}
          />
          <button
            className="btn btn-primary"
            onClick={handleJoin}
            disabled={!username.trim()}
            style={{ width: '100%' }}
          >
            加入服务
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="container" style={{ padding: '24px 0' }}>
        <div className="status-banner connected">
          🟢 已连接 | 用户名: <strong>{username}</strong> | 服务码: <strong>{code}</strong>
        </div>
        {uploadMsg && (
          <div style={{
            background: '#f0fdf4', border: '1px solid #bbf7d0',
            borderRadius: 6, padding: '8px 14px', marginBottom: 14, fontSize: 13
          }}>
            ✅ {uploadMsg}
          </div>
        )}
        <div className="card">
          <FileList
            files={files}
            canUpload={serviceInfo?.allowUpload || false}
            onDownload={requestFile}
            onUpload={uploadFile}
          />
        </div>
      </div>
    </>
  );
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function downloadFile(name: string, mime: string, data: string) {
  const buffer = base64ToArrayBuffer(data);
  const blob = new Blob([buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function JoinPage() {
  return (
    <Suspense fallback={
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ color: 'var(--muted)' }}>加载中...</p>
      </div>
    }>
      <JoinContent />
    </Suspense>
  );
}
