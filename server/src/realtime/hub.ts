/**
 * 实时推送中心：管理所有 WebSocket 连接，按消息类型广播。
 * 连接建立后由路由层调用 sendSnapshot 下发全量快照。
 */
import type { WebSocket } from 'ws';
import type { WsMessage } from '../types';

export class Hub {
  private clients = new Set<WebSocket>();

  add(socket: WebSocket): void {
    this.clients.add(socket);
    socket.on('close', () => this.clients.delete(socket));
  }

  send(socket: WebSocket, message: WsMessage): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  broadcast(message: WsMessage): void {
    const payload = JSON.stringify(message);
    for (const socket of this.clients) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  get size(): number {
    return this.clients.size;
  }
}
