import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import Editor from '@monaco-editor/react'
import axios from 'axios'

const BACKEND_URL = import.meta.env.VITE_API_BASE_URL;

const STARTER_CODE = `function greet(name) {
  return \`Hello, \${name}!\`;
}

const message = greet("CodeSync");
console.log(message);`

// Deterministic color from a user ID for remote cursor decoration
const CURSOR_COLORS = ['#a78bfa', '#60a5fa', '#34d399', '#f472b6', '#fb923c', '#38bdf8']
const getCursorColor = (userId) => CURSOR_COLORS[userId.charCodeAt(0) % CURSOR_COLORS.length]

// ── RoomPage ──────────────────────────────────────────────────────────────────
// Full collaborative room view using Monaco Editor.
// Props: user (auth user object), socket (socket.io-client instance), onBack (fn)
export default function RoomPage({ user, socket, onBack }) {
  const { roomId } = useParams()
  const [code, setCode]           = useState(STARTER_CODE)
  const [language, setLanguage]   = useState('javascript')
  const [members, setMembers]     = useState([])
  const [stdin, setStdin]         = useState('')
  const [runResult, setRunResult] = useState(null)
  const [isRunning, setIsRunning] = useState(false)

  // Ref to the Monaco editor instance — used for programmatic updates and decorations
  const editorRef   = useRef(null)
  // Flag set to true while applying a remote update so we don't re-emit it
  const isRemote    = useRef(false)
  // Map of userId -> decoration IDs for remote cursors
  const decorations = useRef({})
  const cursorListener = useRef(null)

  // Remove one remote cursor decoration and its generated label style.
  const removeRemoteCursor = useCallback((userId) => {
    if (editorRef.current && decorations.current[userId]) {
      editorRef.current.deltaDecorations(decorations.current[userId], [])
    }
    delete decorations.current[userId]
    document.getElementById(`cursor-style-${userId}`)?.remove()
  }, [])

  // Apply a server code update directly to Monaco without broadcasting it again.
  const applyRemoteCode = useCallback((nextCode, nextLanguage) => {
    isRemote.current = true
    setCode(nextCode)
    if (nextLanguage) setLanguage(nextLanguage)
    const model = editorRef.current?.getModel()
    if (model && model.getValue() !== nextCode) model.setValue(nextCode)
    isRemote.current = false
  }, [])

  // Emit join-room when the component mounts and roomId is available
  useEffect(() => {
    if (!socket || !roomId) return

    socket.emit('join-room', { roomId })

    // Server sends initial code + member list when joining
    socket.on('room-joined', ({ code: initialCode, language: initialLanguage, members: initialMembers }) => {
      applyRemoteCode(initialCode ?? STARTER_CODE, initialLanguage)
      setMembers(initialMembers || [])
    })

    // Receive code updates from other users in the room
    socket.on('code-update', ({ code: newCode, language: newLanguage }) => {
      applyRemoteCode(newCode ?? '', newLanguage)
    })

    // Receive updated member list when someone joins or leaves
    socket.on('room-members-update', (updatedMembers) => {
      setMembers(updatedMembers)
      const activeMemberIds = new Set(updatedMembers.map(member => member.id))
      Object.keys(decorations.current)
        .filter(userId => !activeMemberIds.has(userId))
        .forEach(removeRemoteCursor)
    })

    // Remove a remote cursor immediately when the server reports a leave.
    socket.on('cursor-clear', ({ userId }) => removeRemoteCursor(userId))

    // Show a room access or lifecycle error without crashing the editor page.
    socket.on('room-error', ({ message }) => console.error(message))

    // Receive remote cursor positions and render them as Monaco decorations
    socket.on('cursor-update', ({ userId, userName, position }) => {
      if (!editorRef.current || !position) return

      const color   = getCursorColor(userId)
      const model = editorRef.current.getModel()
      if (!model) return
      const validPosition = model.validatePosition(position)
      const { lineNumber, column } = validPosition

      // Create an inline decoration at the remote cursor's position
      const newDecorations = editorRef.current.deltaDecorations(
        decorations.current[userId] || [],
        [{
          range: {
            startLineNumber: lineNumber,
            startColumn: column,
            endLineNumber: lineNumber,
            endColumn: column,
          },
          options: {
            className: `remote-cursor-${userId}`,
            afterContentClassName: `remote-cursor-label-${userId}`,
            // Inject a dynamic style for this user's cursor color
            stickiness: 1,
          },
        }]
      )
      decorations.current[userId] = newDecorations

      // Inject or update CSS for this specific remote cursor
      const styleId = `cursor-style-${userId}`
      let styleEl = document.getElementById(styleId)
      if (!styleEl) {
        styleEl = document.createElement('style')
        styleEl.id = styleId
        document.head.appendChild(styleEl)
      }
      styleEl.textContent = `
        .remote-cursor-${userId} { border-left: 2px solid ${color}; }
        .remote-cursor-label-${userId}::after {
          content: '${userName.replace(/'/g, "\\'")}';
          background: ${color};
          color: #0b0c0f;
          font-size: 10px;
          font-weight: 600;
          padding: 1px 5px;
          border-radius: 3px;
          margin-left: 2px;
          pointer-events: none;
        }
      `
    })

    // Cleanup socket listeners when leaving the room
    return () => {
      socket.off('room-joined')
      socket.off('code-update')
      socket.off('room-members-update')
      socket.off('cursor-clear')
      socket.off('room-error')
      socket.off('cursor-update')
      socket.emit('leave-room', { roomId })
      Object.keys(decorations.current).forEach(removeRemoteCursor)
      cursorListener.current?.dispose()
      cursorListener.current = null
      editorRef.current = null
    }
  }, [socket, roomId, applyRemoteCode, removeRemoteCursor])

  // Called by Monaco when the editor content changes
  const handleEditorChange = useCallback((newValue) => {
    if (isRemote.current) return  // Don't re-emit updates received from others
    const nextCode = newValue ?? ''
    setCode(nextCode)
    if (socket && roomId) {
      socket.emit('code-change', { roomId, code: nextCode, language })
    }
  }, [socket, roomId, language])

  // Save a changed language through the same debounced room-state update.
  const handleLanguageChange = (event) => {
    const nextLanguage = event.target.value
    setLanguage(nextLanguage)
    if (socket && roomId) {
      socket.emit('code-change', { roomId, code, language: nextLanguage })
    }
  }

  // Send the current editor code to the backend and show the execution result.
  const handleRun = async () => {
    setIsRunning(true)
    setRunResult(null)
    try {
      const response = await axios.post(`${BACKEND_URL}/api/code/run`, {
        sourceCode: code,
        language,
        stdin,
      }, { withCredentials: true })
      setRunResult(response.data)
    } catch (error) {
      setRunResult({ error: error.response?.data?.message || 'Code execution failed' })
    } finally {
      setIsRunning(false)
    }
  }

  // Called by Monaco when the cursor position changes; broadcast to room
  const handleCursorChange = useCallback((e) => {
    if (!socket || !roomId) return
    const pos = e.position
    if (!pos) return
    socket.emit('cursor-change', {
      roomId,
      position: { lineNumber: pos.lineNumber, column: pos.column },
    })
  }, [socket, roomId])

  // Store the editor instance ref when Monaco mounts
  // Store Monaco and clean up its cursor listener when the room unmounts.
  const handleEditorMount = (editor) => {
    editorRef.current = editor
    cursorListener.current = editor.onDidChangeCursorPosition(handleCursorChange)
  }

  // Avatar color for sidebar members
  const AVATAR_COLORS = ['violet', 'blue', 'amber', 'rose', 'cyan', 'emerald']
  const getAvatarColor = (id) => AVATAR_COLORS[id.charCodeAt(0) % AVATAR_COLORS.length]
  const getInitials    = (name) => name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()

  return (
    <section className="room-page">
      {/* ── Room Header ── */}
      <div className="room-header">
        <div className="room-title">
          <button className="back-button" onClick={onBack}>←</button>
          <div>
            <div className="eyebrow">ROOM / SHARED</div>
            <h2>Session <span>·</span> <small>{roomId?.substring(0, 8)}</small></h2>
          </div>
        </div>
        <div className="room-actions">
          {/* Language selector */}
          <select
            className="lang-select"
            value={language}
            onChange={handleLanguageChange}
          >
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="python">Python</option>
            <option value="java">Java</option>
            <option value="cpp">C++</option>
          </select>
          <button className="primary-button" onClick={handleRun} disabled={isRunning}>
            {isRunning ? 'Running...' : 'Run'}
          </button>
        </div>
      </div>

      {/* ── Main layout: Editor + Sidebar ── */}
      <div className="room-layout">
        {/* Monaco Editor fills the editor panel */}
        <div className="editor-panel">
          <div className="editor-tabs">
            <span className="tab-active">index.{language === 'python' ? 'py' : language === 'java' ? 'java' : language === 'cpp' ? 'cpp' : 'js'}</span>
            <span className="tab-spacer" />
            <span className="save-state">Live sync active</span>
          </div>
          <div className="monaco-wrap">
            <Editor
              height="100%"
              language={language}
              value={code}
              theme="vs-dark"
              onChange={handleEditorChange}
              onMount={handleEditorMount}
              options={{
                fontSize: 13,
                fontFamily: 'monospace',
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbersMinChars: 3,
                padding: { top: 16, bottom: 16 },
                automaticLayout: true,
              }}
            />
          </div>
        </div>

        {/* ── Sidebar: members ── */}
        <aside className="room-sidebar">
          <div className="sidebar-section">
            <div className="side-label">
              IN THIS ROOM <span>{members.length}</span>
            </div>
            {/* Show the current user first */}
            {user && (
              <div className="room-member">
                <div className={`avatar ${getAvatarColor(user.id)}`}>
                  {getInitials(user.name)}
                  <span className="online-ring" />
                </div>
                <div>
                  <strong>{user.name}</strong>
                  <small>You — Editing</small>
                </div>
                <span className="green-dot" />
              </div>
            )}
            {/* Show all other members in this room */}
            {members
              .filter(m => m.id !== user?.id)
              .map(m => (
                <div className="room-member" key={m.id}>
                  <div className={`avatar ${getAvatarColor(m.id)}`}>
                    {getInitials(m.name)}
                    <span className="online-ring" />
                  </div>
                  <div>
                    <strong>{m.name}</strong>
                    <small>Editing</small>
                  </div>
                  <span className="green-dot" />
                </div>
              ))
            }
          </div>
          <div className="room-note">
            <span>⌘</span>
            <div>
              <strong>Tip</strong>
              <p>Changes and cursors are synced in real time.</p>
            </div>
          </div>
          <div className="run-panel">
            <label htmlFor="run-input">Input</label>
            <textarea
              id="run-input"
              value={stdin}
              onChange={(event) => setStdin(event.target.value)}
              placeholder="Optional stdin"
              rows={3}
            />
            {runResult && (
              <div className="run-result">
                <strong>{runResult.status || 'Result'}</strong>
                {runResult.output && <pre>{runResult.output}</pre>}
                {runResult.error && <pre>{runResult.error}</pre>}
                {runResult.compileError && <pre>{runResult.compileError}</pre>}
                {runResult.message && <pre>{runResult.message}</pre>}
                {runResult.time !== undefined && <small>Time: {runResult.time}s</small>}
                {runResult.memory !== undefined && <small>Memory: {runResult.memory} KB</small>}
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}
