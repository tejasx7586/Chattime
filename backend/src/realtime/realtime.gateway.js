const clientsByUser = new Map();
const HEARTBEAT_INTERVAL_MS = 25_000;

const serializeData = (data) => JSON.stringify(data ?? {});

const sendEvent = (res, event, data) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${serializeData(data)}\n\n`);
};

const getUserClientSet = (userId) => {
  if (!clientsByUser.has(userId)) {
    clientsByUser.set(userId, new Set());
  }

  return clientsByUser.get(userId);
};

export const isUserOnline = (userId) =>
  clientsByUser.has(userId) && clientsByUser.get(userId).size > 0;

export const emitToUser = (userId, event, data) => {
  const clients = clientsByUser.get(userId);

  if (!clients) {
    return;
  }

  clients.forEach((client) => {
    sendEvent(client, event, data);
  });
};

const emitToAll = (event, data) => {
  clientsByUser.forEach((clients) => {
    clients.forEach((client) => {
      sendEvent(client, event, data);
    });
  });
};

export const openRealtimeStream = (req, res) => {
  const userId = req.user._id.toString();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clients = getUserClientSet(userId);
  clients.add(res);

  if (clients.size === 1) {
    emitToAll('presence', { userId, isOnline: true });
  }

  sendEvent(res, 'connected', { userId });

  const heartbeat = setInterval(() => {
    sendEvent(res, 'heartbeat', { now: Date.now() });
  }, HEARTBEAT_INTERVAL_MS);

  req.on('close', () => {
    clearInterval(heartbeat);

    const userClients = clientsByUser.get(userId);
    if (!userClients) {
      return;
    }

    userClients.delete(res);

    if (userClients.size === 0) {
      clientsByUser.delete(userId);
      emitToAll('presence', { userId, isOnline: false });
    }
  });
};
