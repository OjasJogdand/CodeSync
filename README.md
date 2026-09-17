# CodeSync

CodeSync is a real-time collaborative code editor. Users can authenticate, find online developers, create collaboration rooms, edit code together, see each other's cursors, persist the latest room state in PostgreSQL, and run code through the JDoodle Compiler API.

## 1. Overview

CodeSync connects developers in a shared coding room:

1. A user creates an account or signs in.
2. The People page shows currently online users.
3. A user sends a collaboration request.
4. The other user accepts the request.
5. Both users enter the same Socket.IO room.
6. Monaco Editor synchronizes code and cursor positions in real time.
7. The latest code and language are saved to PostgreSQL.
8. The Run button sends code to the backend, which executes it through JDoodle.

## 2. Tech Stack

| Category | Technologies |
| --- | --- |
| Frontend | React, Vite, JSX, Axios |
| Editor | Monaco Editor |
| Backend | Node.js, Express, Socket.IO, ES Modules |
| Authentication | JWT, HTTP-only cookies, bcrypt |
| Database | PostgreSQL, Supabase, Prisma |
| Code execution | JDoodle Compiler API, Axios |
| Development | npm, Vite |

## 3. Project Structure

```text
codesync/
├── backend/
│   ├── controllers/
│   │   ├── authController.js
│   │   └── codeController.js
│   ├── middleware/
│   │   └── authMiddleware.js
│   ├── prisma/
│   │   └── schema.prisma
│   ├── routes/
│   │   ├── authRoutes.js
│   │   └── codeRoutes.js
│   ├── services/
│   │   ├── authService.js
│   │   └── codeService.js
│   ├── socket/
│   │   └── socketHandler.js
│   ├── .env.example
│   ├── server.js
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/ui/
│   │   ├── App.jsx
│   │   ├── Auth.jsx
│   │   ├── RoomPage.jsx
│   │   └── main.jsx
│   ├── index.html
│   └── package.json
├── .gitignore
└── README.md
```

## 4. Main Modules

- **Authentication**: Email/password signup and login with bcrypt password hashing and JWT authentication.
- **HTTP-only sessions**: JWT tokens are stored in an HTTP-only cookie and checked by backend middleware.
- **People page**: Displays real-time online users through Socket.IO presence events.
- **Collaboration requests**: Users can send, accept, or decline collaboration requests.
- **Room creation**: Accepted requests create a PostgreSQL room and two room memberships.
- **Monaco Editor**: Provides the code editing experience inside each room.
- **Real-time code sync**: Full-code updates are sent through the Socket.IO room without echoing updates back to the sender.
- **Cursor sync**: Monaco cursor positions are broadcast to other room members and displayed with user labels.
- **Room persistence**: The latest code and selected language are saved to the existing `Room` model after a short debounce delay.
- **Code execution**: The backend sends source code, language, and stdin to JDoodle using server-side credentials.

## 5. Real-Time Collaboration Flow

```text
User A Monaco Editor
        │
        │ code-change / cursor-change
        ▼
Socket.IO backend
        │
        │ room-scoped broadcast
        ▼
User B Monaco Editor
```

Important Socket.IO events include:

| Event | Purpose |
| --- | --- |
| `online_users_update` | Broadcast online users |
| `collaboration_request` | Send a collaboration request |
| `receive_collaboration_request` | Deliver an incoming request |
| `accept_collaboration` | Create a shared room |
| `collaboration_accepted` | Navigate both users to the room |
| `join-room` | Join a room and load its state |
| `room-joined` | Return code, language, and members |
| `code-change` | Send a code or language change |
| `code-update` | Broadcast code state to other members |
| `cursor-change` | Send a cursor position |
| `cursor-update` | Broadcast a remote cursor |
| `leave-room` | Remove a user from a room |
| `cursor-clear` | Remove a user's remote cursor |

## 6. Features

- Email/password authentication
- JWT authentication with HTTP-only cookies
- Online user presence
- Collaboration requests with accept and decline actions
- Shared rooms for two or more connected members
- Monaco Editor integration
- JavaScript, TypeScript, Python, Java, and C++ language selection
- Full-code real-time synchronization
- Remote cursor labels and colors
- PostgreSQL persistence for room code and language
- Optional stdin input for code execution
- JDoodle execution results including output, errors, status, CPU time, and memory when provided
- Room membership authorization
- Different rooms remain isolated from each other

## 7. Installation

### Prerequisites

- Node.js 18 or newer
- npm
- PostgreSQL or a Supabase PostgreSQL database
- JDoodle Compiler API credentials

### Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
cd codesync
```

### Install backend dependencies

```bash
cd backend
npm install
```

### Install frontend dependencies

```bash
cd ../frontend
npm install
```

### Configure environment variables

Copy the example file:

```bash
cd ../backend
copy .env.example .env
```

On macOS or Linux, use:

```bash
cp .env.example .env
```

Edit `backend/.env` and add your PostgreSQL, JWT, and JDoodle values.

### Generate Prisma Client and sync the database

```bash
npx prisma generate
npx prisma db push
```

## 8. Environment Variables

Create `backend/.env`:

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL or Supabase connection string |
| `JWT_SECRET` | Secret used to sign JWT tokens |
| `PORT` | Backend port, normally `8000` |
| `FRONTEND_URL` | Frontend origin, normally `http://localhost:5173` |
| `JDOODLE_CLIENT_ID` | JDoodle client ID; keep it on the backend |
| `JDOODLE_CLIENT_SECRET` | JDoodle client secret; keep it on the backend |

Never commit `backend/.env`. The root `.gitignore` excludes environment files, while `backend/.env.example` is safe to commit.

## 9. Database Schema

The PostgreSQL database uses Prisma with three models:

- **User**: Stores account details and authentication data.
- **Room**: Stores room name, latest code, selected language, owner, and timestamps.
- **RoomMember**: Connects users to rooms with a unique room/user relationship.

## 10. API Endpoints

| Method | Route | Purpose | Authentication |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Check whether the backend is running | No |
| `POST` | `/api/auth/signup` | Create an account | No |
| `POST` | `/api/auth/login` | Sign in and receive an HTTP-only cookie | No |
| `POST` | `/api/auth/logout` | Clear the authentication cookie | No |
| `GET` | `/api/auth/me` | Get the current authenticated user | Yes |
| `POST` | `/api/code/run` | Execute code through JDoodle | Yes |

The code execution endpoint accepts:

```json
{
  "sourceCode": "console.log('Hello, CodeSync')",
  "language": "javascript",
  "stdin": ""
}
```

## 11. Running the Application

Start the backend in one terminal:

```bash
cd backend
npm start
```

Start the frontend in a second terminal:

```bash
cd frontend
npm run dev
```

Open the Vite URL shown in the frontend terminal, normally:

```text
http://localhost:5173
```

The backend normally runs at:

```text
http://localhost:8000
```

## 12. Deployment Notes

- Deploy the frontend as a Vite application on Vercel or another static hosting platform.
- Deploy the backend as a Node.js service on a platform such as Render.
- Use Supabase or another managed PostgreSQL provider for production data.
- Set production CORS, database, JWT, and JDoodle environment variables in the hosting platform.
- Never expose `JDOODLE_CLIENT_ID`, `JDOODLE_CLIENT_SECRET`, `DATABASE_URL`, or `JWT_SECRET` in frontend code.

## 13. Future Improvements

- More robust multi-user editing using a CRDT or OT system
- Multiple files per room
- Room history and versioning
- Chat inside rooms
- Code execution history
- Production deployment configuration
- Automated integration tests for two-user collaboration
