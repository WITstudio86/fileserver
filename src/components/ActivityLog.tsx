// src/components/ActivityLog.tsx
import { useState } from 'react';

interface LogEntry {
  id: number;
  user_name: string;
  action: string;
  detail: string | null;
  created_at: string;
}

const actionLabel: Record<string, string> = {
  joined: '加入了服务',
  left: '离开了服务',
  kicked: '被踢出',
  downloaded: '下载了',
  uploaded: '上传了',
  previewed: '预览了',
};

export default function ActivityLog({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState('');
  const users = [...new Set(logs.map(l => l.user_name))];
  const filtered = filter ? logs.filter(l => l.user_name === filter) : logs;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, margin: 0 }}>活动记录</h3>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            padding: '4px 8px', borderRadius: 6,
            border: '1px solid var(--border)', fontSize: 13
          }}
        >
          <option value="">全部用户</option>
          {users.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      {filtered.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>暂无记录</p>
      )}
      {filtered.map(log => (
        <div key={log.id} style={{
          padding: '6px 0', borderBottom: '1px solid #f3f4f6',
          fontSize: 13, color: 'var(--muted)'
        }}>
          <span>{log.created_at}</span>{' '}
          <strong style={{ color: 'var(--fg)' }}>{log.user_name}</strong>{' '}
          {actionLabel[log.action] || log.action}
          {log.detail && <> — {log.detail}</>}
        </div>
      ))}
    </div>
  );
}
