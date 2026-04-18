import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const getCookieValue = (name) => {
  const cookie = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : '';
};

const formatTime = (value) => {
  if (!value) {
    return '';
  }

  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const normalizeMessage = (raw) => ({
  ...raw,
  senderId: typeof raw.senderId === 'string' ? raw.senderId : raw.senderId?._id,
  receiverId: typeof raw.receiverId === 'string' ? raw.receiverId : raw.receiverId?._id,
});

const upsertMessages = (currentMessages, incomingMessages) => {
  const map = new Map(currentMessages.map((message) => [message._id, message]));

  incomingMessages.forEach((message) => {
    map.set(message._id, message);
  });

  return Array.from(map.values()).sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
};

const request = async (path, options = {}) => {
  const csrfToken = getCookieValue('csrfToken');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : {};

  if (!response.ok) {
    throw new Error(data?.message || 'Request failed');
  }

  return data;
};

function App() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [authLoading, setAuthLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [user, setUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [messageLoading, setMessageLoading] = useState(false);
  const [typingByUser, setTypingByUser] = useState({});
  const [selfTyping, setSelfTyping] = useState(false);

  const streamRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const selectedUser = useMemo(
    () => users.find((item) => item._id === selectedUserId) || null,
    [users, selectedUserId]
  );

  const loadSession = useCallback(async () => {
    try {
      const data = await request('/api/auth/me');
      setUser(data.user);
      setError('');
    } catch {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const data = await request('/api/auth/users');
      const userList = data.users || [];
      setUsers(userList);

      if (!selectedUserId && userList.length > 0) {
        setSelectedUserId(userList[0]._id);
      }
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [selectedUserId]);

  const loadMessages = useCallback(async (targetUserId) => {
    if (!targetUserId) {
      setMessages([]);
      return;
    }

    setMessageLoading(true);
    try {
      const data = await request(`/api/messages?userId=${encodeURIComponent(targetUserId)}`);
      const normalized = (data.messages || []).map(normalizeMessage);
      setMessages(normalized);
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setMessageLoading(false);
    }
  }, []);

  const sendTypingSignal = useCallback(
    async (isTyping, targetUserId) => {
      if (!targetUserId) {
        return;
      }

      try {
        await request('/api/realtime/typing', {
          method: 'POST',
          body: JSON.stringify({ toUserId: targetUserId, isTyping }),
        });
      } catch {
        // Ignore transient typing errors.
      }
    },
    []
  );

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!user) {
      setUsers([]);
      setSelectedUserId('');
      setMessages([]);
      setTypingByUser({});
      if (streamRef.current) {
        streamRef.current.close();
        streamRef.current = null;
      }
      return;
    }

    loadUsers();
  }, [user, loadUsers]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const stream = new EventSource(`${API_BASE_URL}/api/realtime/stream`, {
      withCredentials: true,
    });

    const onPresence = (event) => {
      const payload = JSON.parse(event.data || '{}');
      const { userId, isOnline } = payload;

      if (!userId) {
        return;
      }

      setUsers((currentUsers) =>
        currentUsers.map((listUser) =>
          listUser._id === userId ? { ...listUser, isOnline: Boolean(isOnline) } : listUser
        )
      );
    };

    const onTyping = (event) => {
      const payload = JSON.parse(event.data || '{}');
      const { fromUserId, isTyping } = payload;

      if (!fromUserId) {
        return;
      }

      setTypingByUser((current) => ({
        ...current,
        [fromUserId]: Boolean(isTyping),
      }));
    };

    const onIncomingMessage = (event) => {
      const payload = JSON.parse(event.data || '{}');
      if (!payload.message?._id) {
        return;
      }

      const normalized = normalizeMessage(payload.message);

      const inSelectedConversation =
        selectedUserId &&
        [normalized.senderId, normalized.receiverId].includes(selectedUserId) &&
        [normalized.senderId, normalized.receiverId].includes(user._id);

      if (inSelectedConversation) {
        setMessages((current) => upsertMessages(current, [normalized]));
      }

      if (normalized.senderId === selectedUserId && normalized.receiverId === user._id) {
        loadMessages(selectedUserId);
      }

      setTypingByUser((current) => ({
        ...current,
        [normalized.senderId]: false,
      }));
    };

    const onReadReceipt = (event) => {
      const payload = JSON.parse(event.data || '{}');
      const messageIds = payload.messageIds || [];
      const readAt = payload.readAt;

      if (!Array.isArray(messageIds) || messageIds.length === 0 || !readAt) {
        return;
      }

      setMessages((current) =>
        current.map((message) =>
          messageIds.includes(message._id)
            ? {
                ...message,
                readAt,
                deliveredAt: message.deliveredAt || readAt,
              }
            : message
        )
      );
    };

    stream.addEventListener('presence', onPresence);
    stream.addEventListener('typing', onTyping);
    stream.addEventListener('message:new', onIncomingMessage);
    stream.addEventListener('message:read', onReadReceipt);

    streamRef.current = stream;

    return () => {
      stream.removeEventListener('presence', onPresence);
      stream.removeEventListener('typing', onTyping);
      stream.removeEventListener('message:new', onIncomingMessage);
      stream.removeEventListener('message:read', onReadReceipt);
      stream.close();
      if (streamRef.current === stream) {
        streamRef.current = null;
      }
    };
  }, [user, selectedUserId, loadMessages]);

  useEffect(() => {
    if (!user || !selectedUserId) {
      setMessages([]);
      return;
    }

    loadMessages(selectedUserId);

    const interval = setInterval(() => {
      if (!document.hidden) {
        loadMessages(selectedUserId);
      }
    }, 15000);

    return () => {
      clearInterval(interval);
    };
  }, [user, selectedUserId, loadMessages]);

  useEffect(
    () => () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    },
    []
  );

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAuth = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const payload = {
        email: form.email.trim(),
        password: form.password,
      };

      if (mode === 'signup') {
        payload.name = form.name.trim();
      }

      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const data = await request(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setUser(data.user);
      setForm({ name: '', email: '', password: '' });
    } catch (authError) {
      setError(authError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await request('/api/auth/logout', { method: 'POST' });
      setUser(null);
      setSelfTyping(false);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      setError('');
    } catch (logoutError) {
      setError(logoutError.message);
    }
  };

  const handleMessageChange = (event) => {
    const value = event.target.value;
    setMessageText(value);

    if (!selectedUserId) {
      return;
    }

    if (value.trim() && !selfTyping) {
      setSelfTyping(true);
      sendTypingSignal(true, selectedUserId);
    }

    if (!value.trim() && selfTyping) {
      setSelfTyping(false);
      sendTypingSignal(false, selectedUserId);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    if (value.trim()) {
      typingTimeoutRef.current = setTimeout(() => {
        setSelfTyping(false);
        sendTypingSignal(false, selectedUserId);
      }, 1200);
    }
  };

  const handleSendMessage = async (event) => {
    event.preventDefault();

    if (!selectedUserId || !messageText.trim()) {
      return;
    }

    setSubmitting(true);
    try {
      const data = await request('/api/messages/send', {
        method: 'POST',
        body: JSON.stringify({ receiverId: selectedUserId, text: messageText.trim() }),
      });

      if (data.message?._id) {
        setMessages((current) => upsertMessages(current, [normalizeMessage(data.message)]));
      }

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      setSelfTyping(false);
      await sendTypingSignal(false, selectedUserId);

      setMessageText('');
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return <main className="app-shell">Loading Chattime…</main>;
  }

  if (!user) {
    return (
      <main className="app-shell">
        <section className="card auth-card">
          <h1>Chattime</h1>
          <p className="muted">Simple secure messaging</p>

          <div className="toggle-row">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
              Login
            </button>
            <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
              Sign up
            </button>
          </div>

          <form onSubmit={handleAuth} className="form-stack">
            {mode === 'signup' && (
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="Name"
                minLength={2}
                maxLength={50}
                required
              />
            )}
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="Email"
              required
            />
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              placeholder="Password"
              minLength={6}
              required
            />
            <button disabled={submitting} type="submit">
              {submitting ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Login'}
            </button>
          </form>

          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="chat-layout">
        <aside className="sidebar card">
          <div className="sidebar-header">
            <h2>{user.name}</h2>
            <button type="button" onClick={handleLogout}>
              Logout
            </button>
          </div>

          <h3>Users</h3>
          {users.length === 0 ? (
            <p className="muted">No users found.</p>
          ) : (
            <ul className="user-list">
              {users.map((item) => (
                <li key={item._id}>
                  <button
                    type="button"
                    className={item._id === selectedUserId ? 'active' : ''}
                    onClick={() => {
                      setSelectedUserId(item._id);
                      setTypingByUser((current) => ({ ...current, [item._id]: false }));
                    }}
                  >
                    <span>{item.name}</span>
                    <span className={`presence-dot ${item.isOnline ? 'online' : ''}`} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="chat-panel card">
          <h2>{selectedUser ? `Chat with ${selectedUser.name}` : 'Select a user'}</h2>
          {selectedUser && (
            <p className="muted chat-presence">{selectedUser.isOnline ? 'Online' : 'Offline'}</p>
          )}

          <div className="messages">
            {messageLoading ? (
              <p className="muted">Loading messages…</p>
            ) : messages.length === 0 ? (
              <p className="muted">No messages yet.</p>
            ) : (
              messages.map((msg) => {
                const isOwn = msg.senderId === user._id;
                const statusText = msg.readAt ? 'Read' : msg.deliveredAt ? 'Delivered' : 'Sent';

                return (
                  <div key={msg._id} className={`message ${isOwn ? 'outgoing' : 'incoming'}`}>
                    <p>{msg.text}</p>
                    <p className="meta">{isOwn ? `${statusText} • ${formatTime(msg.createdAt)}` : formatTime(msg.createdAt)}</p>
                  </div>
                );
              })
            )}
          </div>

          {selectedUserId && typingByUser[selectedUserId] && <p className="muted typing-indicator">{selectedUser?.name} is typing…</p>}

          <form className="message-form" onSubmit={handleSendMessage}>
            <input
              value={messageText}
              onChange={handleMessageChange}
              placeholder="Type your message"
              maxLength={2000}
              disabled={!selectedUserId || submitting}
              required
            />
            <button type="submit" disabled={!selectedUserId || submitting || !messageText.trim()}>
              Send
            </button>
          </form>

          {error && <p className="error">{error}</p>}
        </section>
      </section>
    </main>
  );
}

export default App;
