// src/lib/types.ts

export type TokenStatus = 'unused' | 'used' | 'expired';

export interface TokenRow {
  id: string;
  status: TokenStatus;
  service_id: string | null;
  created_at: string;
  used_at: string | null;
  expires_at: string;
}

export type ServiceStatus = 'configuring' | 'active' | 'closed';

export interface ServiceRow {
  id: string;
  token_id: string;
  code: string | null;
  status: ServiceStatus;
  share_path: string | null;
  max_users: number;
  allow_upload: number;
  current_users: number;
  created_at: string;
  started_at: string | null;
  expires_at: string | null;
}

export type LogAction = 'joined' | 'left' | 'kicked' | 'downloaded' | 'uploaded' | 'previewed';

export interface ActivityLogRow {
  id: number;
  service_id: string;
  user_name: string;
  action: LogAction;
  detail: string | null;
  created_at: string;
}

// Handled by server (routing logic)
type WsRoutedMessage =
  | { type: 'register'; code: string; token: string }
  | { type: 'join'; code: string; username: string }
  | { type: 'signal'; target: string; payload: unknown }
  | { type: 'kick'; userId: string }
  | { type: 'close' };

// Pass-through: broadcast to all clients in service
type WsPassThroughMessage =
  | { type: 'file-list'; files: FileMeta[] }
  | { type: 'file-request'; fileId: string; userName?: string }
  | { type: 'file-response'; fileId: string; name: string; mime: string; data: string } // base64
  | { type: 'file-upload'; name: string; mime: string; data: string } // base64
  | { type: 'file-uploaded'; name: string; userName: string };

export type WsClientMessage = WsRoutedMessage | WsPassThroughMessage;

export interface WsUser {
  userId: string;
  username: string;
}

// Handled by server (routing logic)
type WsRoutedResponse =
  | { type: 'signal'; from: string; payload: unknown }
  | { type: 'user-joined'; user: WsUser }
  | { type: 'user-left'; userId: string }
  | { type: 'kicked' }
  | { type: 'joined'; serviceId: string; hostUserId: string }
  | { type: 'host-left' }
  | { type: 'error'; message: string };

export type WsServerMessage = WsRoutedResponse | WsPassThroughMessage;

export interface FileMeta {
  fileId: string;
  name: string;
  size: number;
  mime: string;
}
