// src/components/UserManager.tsx

interface Peer {
  userId: string;
  username: string;
}

export default function UserManager({ peers, ws }: {
  peers: Peer[];
  ws: WebSocket | null;
}) {
  return (
    <div>
      <h3 style={{ fontSize: 16, margin: '0 0 12px' }}>在线用户 ({peers.length})</h3>
      {peers.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>等待加入...</p>
      )}
      {peers.map(peer => (
        <div key={peer.userId} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 14
        }}>
          <span>
            <span style={{
              display: 'inline-block', width: 8, height: 8,
              borderRadius: '50%', background: '#22c55e',
              marginRight: 8,
            }}/>
            {peer.username}
          </span>
        </div>
      ))}
    </div>
  );
}
