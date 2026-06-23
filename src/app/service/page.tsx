// src/app/service/page.tsx
'use client';
import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import ServiceConfig from '@/components/ServiceConfig';
import UserManager from '@/components/UserManager';
import ActivityLog from '@/components/ActivityLog';
import type { WsServerMessage, FileMeta } from '@/lib/types';

function ServiceContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [state, setState] = useState<'validating' | 'configuring' | 'active' | 'invalid'>('validating');
  const [serviceId, setServiceId] = useState('');
  const [peers, setPeers] = useState<{ userId: string; username: string }[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [serviceCode, setServiceCode] = useState('');
  const [files, setFiles] = useState<FileMeta[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const serviceIdRef = useRef('');

  // Keep serviceIdRef in sync
  useEffect(() => { serviceIdRef.current = serviceId; }, [serviceId]);

  useEffect(() => {
    if (!token) { setState('invalid'); return; }
    fetch(`/api/token/status/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.status === 'unused') setState('configuring');
        else if (data.status === 'used') {
          setState('active');
          setServiceId(data.serviceId || '');
        } else setState('invalid');
      })
      .catch(() => setState('invalid'));
  }, [token]);

  const fetchLogs = useCallback(async () => {
    const sid = serviceIdRef.current;
    if (!sid) return;
    const res = await fetch(`/api/logs/${sid}?token=${token}`);
    const data = await res.json();
    if (data.logs) setLogs(data.logs);
  }, [token]);

  // Store fetchLogs in ref so WebSocket callbacks always get latest
  const fetchLogsRef = useRef(fetchLogs);
  fetchLogsRef.current = fetchLogs;

  // Read files from the directory handle
  const readDirectoryFiles = useCallback(async (): Promise<FileMeta[]> => {
    const dirHandle = (window as any).__shareDirHandle;
    if (!dirHandle) return [];

    const fileList: FileMeta[] = [];
    try {
      for await (const [name, handle] of (dirHandle as any).entries()) {
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          fileList.push({
            fileId: name,
            name,
            size: file.size,
            mime: file.type || 'application/octet-stream',
          });
        }
      }
    } catch (err) {
      console.error('Failed to read directory:', err);
    }
    return fileList;
  }, []);

  // Send file list to all joiners
  const sendFileList = useCallback(async () => {
    const fileList = await readDirectoryFiles();
    console.log('[Host] sendFileList:', fileList.length, 'files, ws readyState:', wsRef.current?.readyState);
    setFiles(fileList);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'file-list', files: fileList }));
    }
  }, [readDirectoryFiles]);

  const sendFileListRef = useRef(sendFileList);
  sendFileListRef.current = sendFileList;

  // Handle file requests from joiners
  const handleFileRequest = useCallback(async (fileId: string, userName?: string) => {
    const dirHandle = (window as any).__shareDirHandle;
    if (!dirHandle) return;
    try {
      const fileHandle = await dirHandle.getFileHandle(fileId);
      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'file-response',
          fileId,
          name: file.name,
          mime: file.type || 'application/octet-stream',
          data: base64,
        }));
      }
      // Log download activity with the actual username
      const sid = serviceIdRef.current;
      if (sid && userName) {
        fetch(`/api/logs/${sid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            userName,
            action: 'downloaded',
            detail: fileId,
          }),
        }).catch(() => {});
        fetchLogsRef.current();
      }
    } catch (err) {
      console.error('Failed to read file:', err);
    }
  }, [token]);

  const handleFileRequestRef = useRef(handleFileRequest);
  handleFileRequestRef.current = handleFileRequest;

  // Handle uploaded files from joiners
  const handleFileUpload = useCallback(async (msg: any) => {
    const dirHandle = (window as any).__shareDirHandle;
    if (!dirHandle) return;
    try {
      const bytes = base64ToArrayBuffer(msg.data);
      const fileHandle = await dirHandle.getFileHandle(msg.name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(bytes);
      await writable.close();

      // Log the upload activity
      const sid = serviceIdRef.current;
      if (sid && msg.userName) {
        fetch(`/api/logs/${sid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            userName: msg.userName,
            action: 'uploaded',
            detail: msg.name,
          }),
        }).catch(() => {});
        fetchLogsRef.current();
      }

      await sendFileListRef.current();

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'file-uploaded',
          name: msg.name,
          userName: msg.userName || '',
        }));
      }
    } catch (err) {
      console.error('Failed to save uploaded file:', err);
    }
  }, [token]);

  const handleFileUploadRef = useRef(handleFileUpload);
  handleFileUploadRef.current = handleFileUpload;

  const connectWebSocket = useCallback((code: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'register', code, token }));
    };

    ws.onmessage = (e) => {
      const msg: WsServerMessage = JSON.parse(e.data);
      console.log('[Host] WS recv:', msg.type, msg);
      switch (msg.type) {
        case 'joined':
          setServiceId(msg.serviceId);
          serviceIdRef.current = msg.serviceId;
          // Now that we're registered, send the file list
          sendFileListRef.current();
          break;
        case 'user-joined':
          setPeers(prev => [...prev, msg.user]);
          fetchLogsRef.current();
          sendFileListRef.current();
          break;
        case 'user-left':
          setPeers(prev => prev.filter(p => p.userId !== msg.userId));
          fetchLogsRef.current();
          break;
        case 'file-request':
          handleFileRequestRef.current(msg.fileId, msg.userName);
          break;
        case 'file-upload':
          handleFileUploadRef.current(msg);
          break;
        case 'host-left':
          setState('invalid');
          break;
        case 'error':
          console.error('WS error:', msg.message);
          break;
      }
    };

    ws.onclose = () => setState('invalid');
  }, [token]);

  const handleConfigSaved = async (cfg: { code: string; maxUsers: number; allowUpload: boolean; sharePath: string }) => {
    const res = await fetch('/api/service/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (data.success) {
      setServiceId(data.serviceId);
      serviceIdRef.current = data.serviceId;
      setServiceCode(cfg.code);
      setState('active');
      connectWebSocket(cfg.code);
    }
  };

  const handleClose = () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'close' }));
    }
    setState('invalid');
  };

  if (state === 'validating') {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ color: 'var(--muted)' }}>验证中...</p>
      </div>
    );
  }

  if (state === 'invalid') {
    return (
      <>
        <Header />
        <div style={{ padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⛔</div>
          <p style={{ color: '#ef4444', fontSize: 18, fontWeight: 500, marginBottom: 16 }}>Token 无效或已过期</p>
          <a href="/" className="btn btn-primary" style={{ display: 'inline-flex' }}>返回首页</a>
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      {state === 'configuring' && (
        <ServiceConfig token={token} onConfigSaved={handleConfigSaved} />
      )}
      {state === 'active' && (
        <div className="container" style={{ padding: '24px 0' }}>
          <div className="status-banner active">
            <span>
              🟢 服务运行中 | 码: <strong>{serviceCode}</strong> | 人数: {peers.length}
            </span>
            <span style={{ fontSize: 13, opacity: 0.8 }}>
              共享 {files.length} 个文件
            </span>
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ width: 240, flexShrink: 0, minWidth: 200 }}>
              <div className="card">
                <UserManager peers={peers} ws={wsRef.current} />
              </div>
              <button
                className="btn btn-danger"
                onClick={handleClose}
                style={{ width: '100%', marginTop: 16 }}
              >
                关闭服务
              </button>
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div className="card">
                <ActivityLog logs={logs} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export default function ServicePage() {
  return (
    <Suspense fallback={
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ color: 'var(--muted)' }}>加载中...</p>
      </div>
    }>
      <ServiceContent />
    </Suspense>
  );
}
