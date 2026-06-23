// src/components/FileList.tsx
'use client';
import { useRef, useState } from 'react';
import type { FileMeta } from '@/lib/types';

export default function FileList({ files, canUpload, onDownload, onUpload }: {
  files: FileMeta[];
  canUpload: boolean;
  onDownload: (fileId: string) => void;
  onUpload: (name: string, mime: string, data: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  };

  const handleUpload = () => {
    if (!selectedFile) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      onUpload(selectedFile.name, selectedFile.type || 'application/octet-stream', base64);
      setSelectedFile(null);
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.onerror = () => setUploading(false);
    reader.readAsDataURL(selectedFile);
  };

  return (
    <div>
      <h3 style={{ fontSize: 16, marginBottom: 12 }}>共享文件</h3>
      {files.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>暂无文件</p>
      )}
      {files.map(f => (
        <div key={f.fileId} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 14
        }}>
          <span>
            {f.mime?.startsWith('image/') ? '🖼' : '📄'} {f.name}
            <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 8 }}>
              ({formatSize(f.size)})
            </span>
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {f.mime?.startsWith('image/') && (
              <button
                className="btn btn-secondary"
                style={{ fontSize: 12, padding: '4px 12px' }}
                onClick={() => onDownload(f.fileId)}
              >
                👁 预览
              </button>
            )}
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '4px 12px' }}
              onClick={() => onDownload(f.fileId)}
            >
              ⬇ 下载
            </button>
          </div>
        </div>
      ))}

      {canUpload && (
        <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <h4 style={{ fontSize: 14, marginBottom: 12 }}>上传文件</h4>

          <label style={{
            display: 'flex', alignItems: 'center', gap: 12,
            border: '2px dashed var(--border)', borderRadius: 8,
            padding: '12px 16px', cursor: 'pointer',
            background: '#fafafa',
            transition: 'border-color 0.15s',
          }}>
            <span style={{ fontSize: 22 }}>📁</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {selectedFile ? selectedFile.name : '点击选择文件'}
              </div>
              {selectedFile && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {formatSize(selectedFile.size)}
                </div>
              )}
              {!selectedFile && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  选择要上传到共享目录的文件
                </div>
              )}
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </label>

          {selectedFile && (
            <button
              className="btn btn-primary"
              onClick={handleUpload}
              disabled={uploading}
              style={{ marginTop: 12, width: '100%' }}
            >
              {uploading ? '⏳ 上传中...' : `📤 上传 ${selectedFile.name}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
