import { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const getCookieValue = (name) => {
  const cookie = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : '';
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
      setUsers(data.users || []);
      if (!selectedUserId && data.users?.length) {
        setSelectedUserId(data.users[0]._id);
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
      setMessages(data.messages || []);
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setMessageLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!user) {
      setUsers([]);
      setSelectedUserId('');
      setMessages([]);
      return;
    }

    loadUsers();
  }, [user, loadUsers]);

  useEffect(() => {
    if (!user || !selectedUserId) {
      setMessages([]);
      return;
    }

    loadMessages(selectedUserId);

    const interval = setInterval(() => {
      if (document.hidden) {
        return;
      }
      loadMessages(selectedUserId);
    }, 5000);

    const onVisible = () => {
      if (!document.hidden) {
        loadMessages(selectedUserId);
      }
    };

    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, selectedUserId, loadMessages]);

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
      setError('');
    } catch (logoutError) {
      setError(logoutError.message);
    }
  };

  const handleSendMessage = async (event) => {
    event.preventDefault();

    if (!selectedUserId || !messageText.trim()) {
      return;
    }

    setSubmitting(true);
    try {
      await request('/api/messages/send', {
        method: 'POST',
        body: JSON.stringify({ receiverId: selectedUserId, text: messageText.trim() }),
      });

      setMessageText('');
      await loadMessages(selectedUserId);
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
                    onClick={() => setSelectedUserId(item._id)}
                  >
                    {item.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="chat-panel card">
          <h2>{selectedUser ? `Chat with ${selectedUser.name}` : 'Select a user'}</h2>

          <div className="messages">
            {messageLoading ? (
              <p className="muted">Loading messages…</p>
            ) : messages.length === 0 ? (
              <p className="muted">No messages yet.</p>
            ) : (
              messages.map((msg) => {
                const isOwn = msg.senderId === user._id;
                return (
                  <div key={msg._id} className={`message ${isOwn ? 'outgoing' : 'incoming'}`}>
                    <p>{msg.text}</p>
                  </div>
                );
              })
            )}
          </div>

          <form className="message-form" onSubmit={handleSendMessage}>
            <input
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
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
