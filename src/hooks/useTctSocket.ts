import { useEffect, useRef } from 'react'
import { useDashboardStore } from './useDashboardStore'

export function useTctSocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number>(1000);
  const { setFullSnapshot, updateMember, updateChain, setSquad, setConnection, addLog } = useDashboardStore();

  const connect = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // 在本地开发时，我们需要指定端口，但在生产环境下使用相对路径
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log('[WS] Connecting to:', wsUrl);
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('[WS] Connected');
      setConnection(true);
      reconnectTimeoutRef.current = 1000; // 重置重连时间
      
      // 连接成功后主动请求一次全量快照
      socket.send(JSON.stringify({ type: 'REQ_SNAPSHOT' }));
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        
        switch (payload.type) {
          case 'SNAPSHOT':
            setFullSnapshot(payload.data);
            break;
          case 'CHAIN_UPDATE':
            updateChain(payload.data);
            break;
          case 'MEMBER_SOFT_UPDATE':
            updateMember(payload.id, payload.data);
            break;
          case 'SQUAD_UPDATED':
            setSquad(payload.members);
            break;
          case 'LOG_UPDATE':
            // Atomic replace to avoid N re-renders from forEach
            if (payload.microLogs) {
               useDashboardStore.setState({ microLogs: payload.microLogs });
            }
            break;
          case 'HEARTBEAT':
            // 可以在这里更新 lastUpdatedAt 来检测数据是否过期
            break;
        }
      } catch (e) {
        console.error('[WS] Failed to parse message:', e);
      }
    };

    socket.onclose = () => {
      console.log('[WS] Disconnected. Retrying in', reconnectTimeoutRef.current, 'ms');
      setConnection(false);
      
      setTimeout(() => {
        reconnectTimeoutRef.current = Math.min(reconnectTimeoutRef.current * 2, 30000);
        connect();
      }, reconnectTimeoutRef.current);
    };

    socket.onerror = (err) => {
      console.error('[WS] Error:', err);
      socket.close();
    };

    socketRef.current = socket;
  };

  useEffect(() => {
    connect();
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  // 暴露发送指令的方法
  const sendCommand = (type: string, data: any) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type, ...data }));
    }
  };

  return { sendCommand };
}
