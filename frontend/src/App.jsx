import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import axios from 'axios'
import Auth from './Auth'
import RoomPage from './RoomPage'

const BACKEND_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '')

const starterCode = `function greet(name) {
  return \`Hello, \${name}!\`;
}

const message = greet("CodeSync");
console.log(message);`

// ── Socket singleton ref ─────────────────────────────────────────────────────
// We hold the socket in a module-level ref so the same instance is reused
// across renders and is accessible inside useEffect cleanups.
let socketInstance = null

// ── App Shell ────────────────────────────────────────────────────────────────
function AppContent() {
  const [user, setUser]                   = useState(null)
  const [loading, setLoading]             = useState(true)
  const [onlineUsers, setOnlineUsers]     = useState([])
  const [incomingRequest, setIncomingRequest] = useState(null)  // { fromUserId, fromUserName }
  const [notification, setNotification]   = useState(null)      // quick toast message

  const navigate = useNavigate()

  // Check auth on first load via REST
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/api/auth/me`, { withCredentials: true })
        console.log('[Auth] /api/auth/me result: success', res.data.user.id)
        setUser(res.data.user)
      } catch {
        console.log('[Auth] /api/auth/me result: failed')
        setUser(null)
      } finally {
        setLoading(false)
      }
    }
    checkAuth()
  }, [])

  // Connect / disconnect socket whenever the authenticated user changes
  useEffect(() => {
    if (!user) {
      // Disconnect if the user logs out
      if (socketInstance) {
        socketInstance.disconnect()
        socketInstance = null
      }
      setOnlineUsers([])
      return
    }

    // Create the socket without connecting so listeners are ready first.
    socketInstance = io(BACKEND_URL, { withCredentials: true, autoConnect: false })

    socketInstance.on('connect', () => {
      console.log('[Socket] Connected:', socketInstance.id)
    })

    socketInstance.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error.message)
    })

    // Receive the full updated list of online users from the server
    socketInstance.on('online_users_update', (users) => {
      console.log('[Socket] Online users received:', users)
      setOnlineUsers(users)
    })

    // Phase 7 — receive an incoming collaboration request
    socketInstance.on('receive_collaboration_request', ({ fromUserId, fromUserName }) => {
      console.log('[Socket] Collaboration request received:', fromUserId)
      setIncomingRequest({ fromUserId, fromUserName })
    })

    // Phase 7 — requester is notified when the other party declines
    socketInstance.on('collaboration_declined', ({ byUserName }) => {
      console.log('[Socket] Collaboration response received: declined', byUserName)
      showNotification(`${byUserName} declined your request.`)
    })

    // Phase 8 — both users navigate to the new room on acceptance
    socketInstance.on('collaboration_accepted', ({ roomId }) => {
      console.log('[Socket] Collaboration response received: accepted', roomId)
      setIncomingRequest(null)
      navigate(`/room/${roomId}`)
    })

    // Surface any server-side errors as a toast
    socketInstance.on('collaboration_error', ({ message }) => {
      console.log('[Socket] Collaboration response received: error', message)
      showNotification(message)
    })

    socketInstance.connect()

    return () => {
      socketInstance.disconnect()
      socketInstance = null
    }
  }, [user])

  // Show a temporary notification that auto-dismisses after 3 seconds
  const showNotification = (msg) => {
    setNotification(msg)
    setTimeout(() => setNotification(null), 3000)
  }

  // Send a collaboration request to another user via socket
  const sendCollaborationRequest = (toUserId) => {
    if (!socketInstance) return
    socketInstance.emit('collaboration_request', { toUserId })
    showNotification('Collaboration request sent!')
  }

  // Accept the incoming request — server will create the room
  const acceptRequest = () => {
    if (!socketInstance || !incomingRequest) return
    socketInstance.emit('accept_collaboration', { fromUserId: incomingRequest.fromUserId })
  }

  // Decline the incoming request and notify the requester
  const declineRequest = () => {
    if (!socketInstance || !incomingRequest) return
    socketInstance.emit('decline_collaboration', { toUserId: incomingRequest.fromUserId })
    setIncomingRequest(null)
  }

  // Log out: clear cookie via REST then reset state
  const handleLogout = async () => {
    try {
      await axios.post(`${BACKEND_URL}/api/auth/logout`, {}, { withCredentials: true })
    } catch { /* ignore */ }
    setUser(null)
    navigate('/auth')
  }

  if (loading) {
    return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', color: '#8a8f9c' }}>Loading...</div>
  }

  // Guard component: redirect to /auth if not logged in
  const ProtectedRoute = ({ children }) => {
    if (!user) return <Navigate to="/auth" />
    return children
  }

  // Online users visible to the current user (exclude themselves)
  const peersOnline = onlineUsers.filter(u => u.id !== user?.id)

  return (
    <main className="app-shell">
      {/* ── Toast notification ─── */}
      {notification && (
        <div className="toast-notification">{notification}</div>
      )}

      {/* ── Incoming collaboration request modal ─── */}
      {incomingRequest && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-icon">🤝</div>
            <h3>{incomingRequest.fromUserName} wants to collaborate</h3>
            <p>You'll both be placed in a shared coding room.</p>
            <div className="modal-actions">
              <button className="outline-button" onClick={declineRequest}>Decline</button>
              <button className="primary-button" onClick={acceptRequest}>Accept</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Top navigation bar ─── */}
      <header className="topbar">
        <button className="brand" onClick={() => navigate('/')} aria-label="Go to CodeSync home">
          <span className="brand-mark">&lt;/&gt;</span>
          <span>codesync</span>
        </button>
        {user && (
          <nav className="topnav" aria-label="Main navigation">
            <button onClick={() => navigate('/people')}>People</button>
          </nav>
        )}
        <div className="top-actions">
          {user ? (
            <>
              <span className="user-pill">
                <span className="mini-avatar">{user.name.substring(0, 2).toUpperCase()}</span>
                {user.name}
              </span>
              <button className="text-button" onClick={handleLogout}>Log out</button>
            </>
          ) : (
            <>
              <button className="text-button" onClick={() => navigate('/auth')}>Sign in</button>
              <button className="outline-button" onClick={() => navigate('/auth')}>Create account</button>
            </>
          )}
        </div>
      </header>

      {/* ── Routes ─── */}
      <Routes>
        <Route path="/" element={
          <Home onEnter={() => user ? navigate('/people') : navigate('/auth')} />
        } />
        <Route path="/auth" element={
          user ? <Navigate to="/people" /> :
            <Auth onAuthSuccess={(u) => { setUser(u); navigate('/people') }} />
        } />
        <Route path="/people" element={
          <ProtectedRoute>
            <People
              peers={peersOnline}
              onSelect={sendCollaborationRequest}
            />
          </ProtectedRoute>
        } />
        <Route path="/room/:roomId" element={
          <ProtectedRoute>
            <RoomPage user={user} socket={socketInstance} onBack={() => navigate('/people')} />
          </ProtectedRoute>
        } />
        {/* Legacy redirect */}
        <Route path="/home" element={<Navigate to="/" />} />
      </Routes>
    </main>
  )
}

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  )
}

// ── Home landing page ─────────────────────────────────────────────────────────
function Home({ onEnter }) {
  return (
    <section className="home-page">
      <div className="home-copy">
        <div className="eyebrow"><span className="pulse-dot" /> Real-time code collaboration</div>
        <h1>Build together.<br /><em>Ship better.</em></h1>
        <p className="hero-text">A focused space for developers to write, review, and run code together — without the noise.</p>
        <div className="hero-actions">
          <button className="primary-button" onClick={onEnter}>Start coding <span>→</span></button>
        </div>
        <div className="trust-line">
          <span className="avatar-stack"><span className="stack-a">MC</span><span className="stack-b">JL</span><span className="stack-c">AS</span></span>
          <span>Join developers already building on CodeSync</span>
        </div>
      </div>
      <div className="hero-visual" aria-label="CodeSync collaboration preview">
        <div className="visual-window">
          <div className="window-bar">
            <span className="window-dots"><i /><i /><i /></span>
            <span className="window-title">room / api-refactor</span>
            <span className="window-live"><b /> live</span>
          </div>
          <div className="window-body">
            <div className="line-numbers">01<br />02<br />03<br />04<br />05<br />06<br />07<br />08<br />09</div>
            <pre>
              <span className="keyword">const</span> <span className="name">collaborators</span> = [<br />
              {'  {'} <span className="property">name:</span> <span className="string">&quot;Maya&quot;</span>, <span className="property">online:</span> <span className="boolean">true</span> {'}'},<br />
              {'  {'} <span className="property">name:</span> <span className="string">&quot;Jordan&quot;</span>, <span className="property">online:</span> <span className="boolean">true</span> {'}'},<br />
              ];<br /><br />
              <span className="keyword">export default</span> <span className="function">collaborators</span>;
            </pre>
            <span className="cursor-line" />
          </div>
          <div className="window-footer">
            <span><b className="green-dot" /> 2 collaborators online</span>
            <span>TypeScript</span>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── People page: shows real online peers ─────────────────────────────────────
// peers — array of online users (current user excluded)
// onSelect — sends a collaboration request via socket
function People({ peers, onSelect }) {
  // Compute initials and a deterministic avatar color from the user's name
  const getInitials = (name) => name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
  const colors = ['violet', 'blue', 'amber', 'rose', 'cyan', 'emerald']
  const getColor = (id) => colors[id.charCodeAt(0) % colors.length]

  return (
    <section className="people-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKSPACE / PEOPLE</div>
          <h2>Who&apos;s around</h2>
          <p>Click someone to send a collaboration request.</p>
        </div>
      </div>
      <div className="people-toolbar">
        <span><b className="green-dot" /> {peers.length} developer{peers.length !== 1 ? 's' : ''} online</span>
      </div>
      <div className="people-grid">
        {peers.length === 0 && (
          <div style={{ gridColumn: '1/-1', padding: '40px 20px', color: '#555b67', textAlign: 'center', fontSize: 13 }}>
            No other developers online yet. Share the link to invite someone!
          </div>
        )}
        {peers.map((peer) => (
          <button
            className="person-card"
            key={peer.id}
            onClick={() => onSelect(peer.id)}
          >
            <div className={`avatar ${getColor(peer.id)}`}>
              {getInitials(peer.name)}
              <span className="online-ring" />
            </div>
            <div className="person-info">
              <strong>{peer.name}</strong>
              <span>{peer.email}</span>
              <small>Click to collaborate</small>
            </div>
            <span className="arrow">↗</span>
          </button>
        ))}
      </div>
    </section>
  )
}
