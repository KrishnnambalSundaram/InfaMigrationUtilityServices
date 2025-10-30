## WebSocket (Socket.IO) Progress Updates

This document explains how to connect to the WebSocket server, listen for real-time progress updates, and emit or test events used by the migration tool.

### Overview

- The server uses Socket.IO to broadcast job progress and system notifications to all connected clients.
- Clients receive events like `connection-established`, `progress-update`, `system-notification`, and `job-statistics`.
- Optional room-based subscription (`join-job`/`leave-job`) is supported, but current progress broadcasts go to all clients.

### Server Initialization

Socket.IO is initialized in `index.js` and mounted on the same HTTP server as Express.

```12:21:/Users/viswajithka/Documents/GitHub/InfaMigrationUtilityServices/websocket/socketService.js
initialize(server) {
  this.io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
  });
  this.setupEventHandlers();
  console.log('🔌 Socket.IO service initialized');
  return this.io;
}
```

```123:129:/Users/viswajithka/Documents/GitHub/InfaMigrationUtilityServices/index.js
// Initialize WebSocket service
websocket.initialize(server);

// Make websocket available globally for progress updates
global.websocket = websocket;
```

### Connection URL

- By default, the server listens on `PORT` from `.env` or 3001.
- The Socket.IO client connects to the same origin as your API server, e.g. `http://localhost:3001`.

### Client Setup (Browser)

1) Include the Socket.IO client script from the server:

```html
<script src="/socket.io/socket.io.js"></script>
```

2) Connect and listen for events:

```html
<script>
  const socket = io('http://localhost:3001');

  socket.on('connect', () => {
    console.log('Connected:', socket.id);
  });

  socket.on('connection-established', (data) => {
    console.log('connection-established', data);
  });

  socket.on('progress-update', (data) => {
    // Optional: filter by jobId
    // if (data.jobId !== myJobId) return;
    console.log('progress-update', data);
  });

  socket.on('system-notification', (data) => {
    console.log('system-notification', data);
  });

  socket.on('job-statistics', (data) => {
    console.log('job-statistics', data);
  });

  socket.on('disconnect', () => {
    console.log('Disconnected');
  });
</script>
```

You can also use the included test pages:

- `http://localhost:3001/progress-listener.html` for a UI that logs events and shows progress.
- `http://localhost:3001/debug-socketio.html` for a minimal connectivity check.

### Client Setup (Node.js)

```bash
npm install socket.io-client
```

```js
const { io } = require('socket.io-client');
const socket = io('http://localhost:3001');

socket.on('connect', () => console.log('Connected', socket.id));
socket.on('progress-update', (data) => console.log('progress-update', data));
socket.on('system-notification', (data) => console.log('system-notification', data));
socket.on('disconnect', () => console.log('Disconnected'));
```

### Events

Server emits these events to clients:

- `connection-established` (on connect)
  - Payload: `{ message, clientId, timestamp }`

- `progress-update` (broadcast)
  - Payload fields (sample superset):
    - `jobId`: string
    - `status`: `'created' | 'pending' | 'completed' | 'failed'`
    - `progress`: number (0-100)
    - `currentStep`: string
    - `steps`: optional array/metadata
    - `result`: any (on completion)
    - `error`: any (on failure)
    - `filesConverted`, `totalFiles`, `elapsedTime`, `estimatedTime`
    - `createdAt`, `updatedAt`, `completedAt`, `failedAt`
    - `timestamp`: ISO string (set by server when broadcasting)

- `system-notification`
  - Payload: `{ message, type: 'info' | 'warning' | 'error', timestamp }`

- `job-statistics`
  - Payload: `{ connectedClients, activeJobs, timestamp }`

Optional client-to-server events:

- `join-job` (`jobId: string`) — joins a room for that job (future room-scoped emits)
- `leave-job` (`jobId: string`)
- `ping` — server replies with `pong` and a timestamp

```24:79:/Users/viswajithka/Documents/GitHub/InfaMigrationUtilityServices/websocket/socketService.js
this.io.on('connection', (socket) => {
  socket.emit('connection-established', { ... });
  socket.on('join-job', (jobId) => socket.join(jobId));
  socket.on('leave-job', (jobId) => socket.leave(jobId));
  socket.on('ping', () => socket.emit('pong', { timestamp: new Date().toISOString() }));
});
```

### Emitting Progress from the Server

Use the exported helpers in `websocket/index.js` from controllers/services/workers.

```1:21:/Users/viswajithka/Documents/GitHub/InfaMigrationUtilityServices/websocket/index.js
module.exports = {
  initialize: (server) => socketService.initialize(server),
  emitProgressUpdate: (jobId, data) => progressEmitter.emitProgressUpdate(jobId, data),
  emitJobCompleted: (jobId, result) => progressEmitter.emitJobCompleted(jobId, result),
  emitJobFailed: (jobId, error) => progressEmitter.emitJobFailed(jobId, error),
  emitFileConversionProgress: (jobId, convertedCount, totalFiles, elapsedTime, estimatedTime) => 
    progressEmitter.emitFileConversionProgress(jobId, convertedCount, totalFiles, elapsedTime, estimatedTime),
  emitSystemNotification: (message, type) => progressEmitter.emitSystemNotification(message, type),
  setJobContext: (jobId, context) => progressEmitter.setJobContext(jobId, context),
  emitProgressUpdateToAll: (data) => socketService.emitProgressUpdateToAll(data),
  emitToAll: (event, data) => socketService.emitToAll(event, data),
};
```

Common patterns:

```js
// When a job is created
global.websocket.emitProgressUpdate(jobId, {
  status: 'created',
  progress: 0,
  currentStep: 'Job created',
  steps: ['validate', 'analyze', 'convert', 'package']
});

// During conversion steps
global.websocket.emitProgressUpdate(jobId, {
  status: 'pending',
  progress: 42,
  currentStep: 'Converting procedures'
});

// File-level progress helper
global.websocket.emitFileConversionProgress(jobId, convertedCount, totalFiles, elapsedMs, etaMs);

// On success
global.websocket.emitJobCompleted(jobId, { outputZip: 'converted_xxx.zip' });

// On failure
global.websocket.emitJobFailed(jobId, { message: 'Parse error', details: ... });
```

### REST Utilities for Testing

The API exposes test endpoints under `/api/websocket`:

- `GET /api/websocket/stats` — returns connected client count and details
- `GET /api/websocket/test` — emits a sample system notification
- `POST /api/websocket/notify` — emits a custom system notification `{ message, type }`

See `index.js` root endpoint for a quick reference of available routes.

### Authentication

- The current Socket.IO configuration allows all origins (`cors: { origin: "*" }`) and does not enforce auth tokens.
- If you need JWT-based auth, add a Socket.IO middleware that validates the token from `auth` query or `Authorization` header and disconnects unauthorized clients.

### Deployment Notes

- Socket.IO is served at `/<namespace>` automatically by the same HTTP server. Ensure any reverse proxy (Nginx/Ingress) forwards WebSocket upgrades.
- Typical proxy config must allow `Upgrade` and `Connection: upgrade` headers and support long-lived connections.
- If hosting UI separately, set `cors.origin` to your UI origin(s) instead of `*`.

### Troubleshooting

- Client cannot load `/socket.io/socket.io.js`:
  - Open the page through the server (e.g., `http://localhost:3001/progress-listener.html`), not `file://`.
  - Ensure the API server is running and port is correct.

- No `progress-update` events received:
  - Verify the server emits via `global.websocket.emitProgressUpdate(...)`.
  - Check server logs for "Emitted progress update" lines.
  - Confirm your client is connected and not filtering out a different `jobId`.

- Proxy/Firewall issues:
  - Ensure WebSocket upgrade headers are forwarded correctly.
  - Allow persistent connections and large timeouts.

### Helpful Test Pages in this Repo

- `public/progress-listener.html` — connect/log progress with optional `jobId` filter.
- `public/debug-socketio.html` — quick connectivity diagnostics.

### Versioning

- Server: `socket.io` (see `package.json`).
- Client: served via `/socket.io/socket.io.js` from the server; for Node clients use the matching `socket.io-client` version.


