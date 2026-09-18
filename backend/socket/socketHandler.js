import { parseCookie } from 'cookie';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// In-memory map: userId -> { id, name, email, socketId }
const onlineUsers = new Map();

// In-memory map: roomId -> { code, language, members: Set<userId>, saveTimer }
// Avoids writing to DB on every keystroke — DB is synced on a timer
const roomState = new Map();

const DEFAULT_ROOM_CODE = `function greet(name) {
  return \`Hello, \${name}!\`;
}

const message = greet("CodeSync");
console.log(message);`;

// Helper: convert the onlineUsers map to a plain array for broadcasting
const getOnlineUsersList = () => {
  return Array.from(onlineUsers.values()).map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
  }));
};

// Helper: get room member details from onlineUsers for sidebar display
const getRoomMembersList = (roomId) => {
  const state = roomState.get(roomId);
  if (!state) return [];
  return Array.from(state.members).map(uid => {
    const u = onlineUsers.get(uid);
    return u ? { id: u.id, name: u.name, email: u.email } : null;
  }).filter(Boolean);
};

// Check whether a user is an authorized member of the requested room.
const isRoomMember = async (roomId, userId) => {
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { id: true },
  });
  return Boolean(membership);
};

// Save the latest room code and language to the database after a short delay.
const saveRoomCodeToDB = async (roomId) => {
  const state = roomState.get(roomId);
  if (!state) return;
  try {
    await prisma.room.update({
      where: { id: roomId },
      data: { code: state.code, language: state.language },
    });
  } catch (err) {
    console.error(`[DB] Failed to save code for room ${roomId}:`, err.message);
  }
};

// Authenticate socket connections using the JWT from the cookie header
const authMiddleware = (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie || '';
    const cookies = parseCookie(cookieHeader);
    const token = cookies.token;
    console.log('[Socket] JWT cookie present:', Boolean(token));

    if (!token) return next(new Error('Authentication error: No token'));

    // Verify token and attach userId to the socket for later use
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    next(new Error('Authentication error: Invalid token'));
  }
};

// Register all socket event handlers on the io server instance
const registerSocketHandlers = (io) => {
  // Apply JWT auth middleware to every incoming socket connection
  io.use(authMiddleware);

  io.on('connection', async (socket) => {
    // Look up user details from the database using the decoded userId
    let dbUser;
    try {
      dbUser = await prisma.user.findUnique({
        where: { id: socket.userId },
        select: { id: true, name: true, email: true },
      });
    } catch (err) {
      console.error('DB lookup failed on connect:', err.message);
      socket.disconnect();
      return;
    }

    if (!dbUser) {
      socket.disconnect();
      return;
    }

    const joinedRoomIds = new Set();

    console.log('[Socket] Authenticated user ID:', dbUser.id);

    // Add user to the presence map and broadcast the updated list to all clients
    onlineUsers.set(dbUser.id, { ...dbUser, socketId: socket.id });
    console.log(`[+] ${dbUser.name} connected (${socket.id})`);
    const connectedUsers = getOnlineUsersList();
    console.log('[Socket] Current online users:', connectedUsers);
    io.emit('online_users_update', connectedUsers);

    // ── Phase 7: Collaboration Request ──────────────────────────────────

    // Forward a collaboration request from the sender to the target user
    socket.on('collaboration_request', ({ toUserId }) => {
      console.log('[Collaboration] Request:', dbUser.id, '->', toUserId);
      const targetUser = onlineUsers.get(toUserId);
      if (!targetUser) {
        console.log('[Collaboration] Target socketId found:', false);
        socket.emit('collaboration_error', { message: 'User is no longer online.' });
        return;
      }
      console.log('[Collaboration] Target socketId found:', true);
      io.to(targetUser.socketId).emit('receive_collaboration_request', {
        fromUserId: dbUser.id,
        fromUserName: dbUser.name,
      });
    });

    // Notify the original requester that their request was declined
    socket.on('decline_collaboration', ({ toUserId }) => {
      console.log('[Collaboration] Declined by:', dbUser.id, 'for:', toUserId);
      const requester = onlineUsers.get(toUserId);
      if (requester) {
        io.to(requester.socketId).emit('collaboration_declined', {
          byUserName: dbUser.name,
        });
      }
    });

    // ── Phase 8: Room Creation on Accept ────────────────────────────────

    // When User B accepts, create a Room + RoomMembers in a DB transaction
    socket.on('accept_collaboration', async ({ fromUserId }) => {
      console.log('[Collaboration] Accepted by:', dbUser.id, 'from:', fromUserId);
      const requester = onlineUsers.get(fromUserId);
      if (!requester) {
        socket.emit('collaboration_error', { message: 'Requester is no longer online.' });
        return;
      }

      try {
        // Create the room and both member records atomically
        const room = await prisma.$transaction(async (tx) => {
          const newRoom = await tx.room.create({
            data: {
              name: `${requester.name} & ${dbUser.name}`,
              ownerId: fromUserId,
            },
          });
          await tx.roomMember.createMany({
            data: [
              { roomId: newRoom.id, userId: fromUserId },
              { roomId: newRoom.id, userId: dbUser.id },
            ],
          });
          return newRoom;
        });

        // Join both sockets to the Socket.IO room channel immediately
        socket.join(room.id);
        const requesterSocket = io.sockets.sockets.get(requester.socketId);
        if (requesterSocket) requesterSocket.join(room.id);

        // Initialize the in-memory room state for this new room
        roomState.set(room.id, { code: DEFAULT_ROOM_CODE, language: 'javascript', members: new Set(), saveTimer: null });

        // Notify both clients to navigate to the new room
        io.to(room.id).emit('collaboration_accepted', { roomId: room.id });
        console.log(`[Room] Created ${room.id} for ${requester.name} & ${dbUser.name}`);
      } catch (err) {
        console.error('Room creation failed:', err.message);
        socket.emit('collaboration_error', { message: 'Failed to create room.' });
      }
    });

    // ── Phase 9/10: Join Room & Code Sync ────────────────────────────────

    // Client emits this when navigating to /room/:roomId
    // Server sends back the current code and member list
    socket.on('join-room', async ({ roomId }) => {
      try {
        if (!roomId || !(await isRoomMember(roomId, dbUser.id))) {
          socket.emit('room-error', { message: 'You are not a member of this room.' });
          return;
        }
      } catch (err) {
        console.error(`[Room] Failed to authorize room ${roomId}:`, err.message);
        socket.emit('room-error', { message: 'Unable to join this room.' });
        return;
      }

      // Rejoin the Socket.IO room channel (needed on page refresh)
      socket.join(roomId);
      joinedRoomIds.add(roomId);

      // Initialize room state if not already tracked in memory
      if (!roomState.has(roomId)) {
        // Load code from DB for this room (e.g., after server restart)
        try {
          const dbRoom = await prisma.room.findUnique({
            where: { id: roomId },
            select: { code: true, language: true },
          });
          roomState.set(roomId, {
            code: dbRoom?.code || DEFAULT_ROOM_CODE,
            language: dbRoom?.language || 'javascript',
            members: new Set(),
            saveTimer: null,
          });
        } catch (err) {
          console.error(`[Room] Failed to load room ${roomId}:`, err.message);
          roomState.set(roomId, { code: DEFAULT_ROOM_CODE, language: 'javascript', members: new Set(), saveTimer: null });
        }
      }

      const state = roomState.get(roomId);
      // Track this user as an active member of this room
      state.members.add(dbUser.id);

      // Send the current code and member list to the joining client only
      socket.emit('room-joined', {
        code: state.code,
        language: state.language,
        members: getRoomMembersList(roomId),
      });

      // Notify everyone else in the room that a new member joined
      socket.to(roomId).emit('room-members-update', getRoomMembersList(roomId));
    });

    // Receive updated code from one user and broadcast to others in the room
    socket.on('code-change', ({ roomId, code, language }) => {
      if (!joinedRoomIds.has(roomId) || typeof code !== 'string') return;
      const state = roomState.get(roomId);
      if (!state) return;

      // Update in-memory code
      state.code = code;
      if (typeof language === 'string') state.language = language;

      // Set up a debounced DB save (resets timer on each change)
      if (state.saveTimer) clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(() => saveRoomCodeToDB(roomId), 10000);

      // Broadcast to every other socket in this room, NOT the sender
      socket.to(roomId).emit('code-update', { code, language: state.language });
    });

    // ── Phase 11: Cursor Synchronization ────────────────────────────────

    // Receive a cursor position from one user and broadcast to others in the room
    socket.on('cursor-change', ({ roomId, position }) => {
      if (!joinedRoomIds.has(roomId)) return;
      if (!position || !Number.isInteger(position.lineNumber) || !Number.isInteger(position.column)) return;
      // Send cursor info (position + user identity) to all other room members
      socket.to(roomId).emit('cursor-update', {
        userId: dbUser.id,
        userName: dbUser.name,
        position, // { lineNumber, column }
      });
    });

    // Remove this socket from a room when the user leaves its page.
    socket.on('leave-room', async ({ roomId }) => {
      if (!joinedRoomIds.has(roomId)) return;
      joinedRoomIds.delete(roomId);
      socket.leave(roomId);

      const state = roomState.get(roomId);
      if (!state) return;
      state.members.delete(dbUser.id);
      socket.to(roomId).emit('room-members-update', getRoomMembersList(roomId));
      socket.to(roomId).emit('cursor-clear', { userId: dbUser.id });

      if (state.members.size === 0) {
        if (state.saveTimer) clearTimeout(state.saveTimer);
        await saveRoomCodeToDB(roomId);
        roomState.delete(roomId);
      }
    });

    // ── Disconnect: cleanup presence and room membership ─────────────────
    socket.on('disconnect', async () => {
      // Only clean up if this socket is still the active one for this user
      const entry = onlineUsers.get(dbUser.id);
      if (entry && entry.socketId === socket.id) {
        onlineUsers.delete(dbUser.id);
        console.log(`[-] ${dbUser.name} disconnected`);
        const connectedUsers = getOnlineUsersList();
        console.log('[Socket] Current online users:', connectedUsers);
        io.emit('online_users_update', connectedUsers);
      }

      // Remove user from all rooms they were part of
      for (const roomId of joinedRoomIds) {
        const state = roomState.get(roomId);
        if (!state) continue;

        state.members.delete(dbUser.id);
        // Notify remaining room members
        socket.to(roomId).emit('room-members-update', getRoomMembersList(roomId));

        // If room is empty, save final code to DB and clear the room state
        if (state.members.size === 0) {
          if (state.saveTimer) clearTimeout(state.saveTimer);
          await saveRoomCodeToDB(roomId);
          roomState.delete(roomId);
          console.log(`[Room] ${roomId} is now empty, code saved to DB`);
        }
      }
    });
  });
};

export default registerSocketHandlers;
