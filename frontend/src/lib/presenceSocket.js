/**
 * Phase C — Real-Time Presence Socket.
 *
 * Maintains ONE WebSocket connection per signed-in user. Exposes a
 * lightweight subscription API:
 *
 *     presenceSocket.connect({ token, onUpdate, onHello })
 *     presenceSocket.disconnect()
 *     presenceSocket.setStatus("live" | "online" | "invisible")
 *     presenceSocket.setMessengerFocus(true|false)
 *
 * Reconnects with exponential backoff. Sends a `heartbeat` every 25s so
 * Kubernetes ingress idle timers do not drop the socket.
 */
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";

function wsUrl(token) {
  const base = BACKEND_URL
    .replace(/^http:/, "ws:")
    .replace(/^https:/, "wss:")
    .replace(/\/+$/, "");
  return `${base}/api/ws/presence?token=${encodeURIComponent(token)}`;
}

let socket = null;
let listeners = new Set();
let helloListeners = new Set();
let reconnectTimer = null;
let heartbeatTimer = null;
let backoff = 1000;     // ms
let manualClose = false;
let lastToken = null;
let messengerFocused = false;

function stopTimers() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

function open(token) {
  manualClose = false;
  lastToken = token;
  try { socket?.close(); } catch { /* */ }
  socket = new WebSocket(wsUrl(token));

  socket.onopen = () => {
    backoff = 1000;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      try { socket?.send(JSON.stringify({ type: "heartbeat" })); } catch { /* */ }
    }, 25000);
    if (messengerFocused) {
      try { socket?.send(JSON.stringify({ type: "presence:focus", messenger: true })); } catch { /* */ }
    }
  };

  socket.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "presence:update") {
      listeners.forEach((fn) => { try { fn(msg); } catch { /* */ } });
    } else if (msg.type === "presence:hello") {
      helloListeners.forEach((fn) => { try { fn(msg); } catch { /* */ } });
    }
  };

  socket.onclose = () => {
    stopTimers();
    if (manualClose || !lastToken) return;
    reconnectTimer = setTimeout(() => open(lastToken), backoff);
    backoff = Math.min(backoff * 2, 30000);
  };

  socket.onerror = () => {
    // onclose will handle reconnect logic
    try { socket?.close(); } catch { /* */ }
  };
}

const presenceSocket = {
  connect({ token, onUpdate, onHello }) {
    if (onUpdate) listeners.add(onUpdate);
    if (onHello) helloListeners.add(onHello);
    if (!socket || socket.readyState === WebSocket.CLOSED || lastToken !== token) {
      open(token);
    }
    return () => {
      if (onUpdate) listeners.delete(onUpdate);
      if (onHello) helloListeners.delete(onHello);
    };
  },

  disconnect() {
    manualClose = true;
    lastToken = null;
    stopTimers();
    try { socket?.close(); } catch { /* */ }
    socket = null;
    listeners.clear();
    helloListeners.clear();
  },

  setStatus(status) {
    try { socket?.send(JSON.stringify({ type: "presence:set", status })); } catch { /* */ }
  },

  setMessengerFocus(focused) {
    messengerFocused = !!focused;
    try { socket?.send(JSON.stringify({ type: "presence:focus", messenger: !!focused })); } catch { /* */ }
  },

  isConnected() {
    return socket && socket.readyState === WebSocket.OPEN;
  },
};

export default presenceSocket;
