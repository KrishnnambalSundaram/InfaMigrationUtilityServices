# WebSocket Module

This module provides real-time WebSocket functionality for the Migration Tool, enabling live progress updates and client communication.

## Structure

```
websocket/
├── index.js           # Main module exports
├── socketService.js   # Core Socket.IO service
├── progressEmitter.js # Progress update emitter
└── README.md         # This file
```

## Features

### 🔌 Socket Service (`socketService.js`)

- Manages Socket.IO server initialization
- Handles client connections and disconnections
- Room management for job-specific updates
- Client tracking and statistics

### 📡 Progress Emitter (`progressEmitter.js`)

- Emits job creation events
- Sends real-time progress updates
- Handles job completion and failure events
- File conversion progress tracking
- System notifications

### 📊 API Endpoints

- `GET /api/websocket/stats` - Get connection statistics
- `GET /api/websocket/test` - Test WebSocket functionality
- `POST /api/websocket/notify` - Send notifications to clients
- `GET /api/websocket/room/:roomId/clients` - Get clients in specific room

## Usage

### Initialize WebSocket

```javascript
const websocket = require("./websocket");
websocket.initialize(server);
```

### Emit Progress Updates

```javascript
// Basic progress update
websocket.emitProgressUpdate(jobId, {
  status: 'pending',
  progress: 50,
  currentStep: 'Converting files...',
  steps: [...]
});

// File conversion progress
websocket.emitFileConversionProgress(jobId, convertedCount, totalFiles, elapsedTime, estimatedTime);

// Job completion
websocket.emitJobCompleted(jobId, result);

// Job failure
websocket.emitJobFailed(jobId, error);
```

### Send Notifications

```javascript
// System notification
websocket.emitSystemNotification("Server maintenance in 5 minutes", "warning");
```

### Get Statistics

```javascript
const clientCount = websocket.getConnectedClientsCount();
const clients = websocket.getConnectedClients();
const roomClients = websocket.getClientsInRoom("job_123");
```

## Client Events

### Connection Events

- `connect` - Client connected
- `disconnect` - Client disconnected

### Room Management

- `join-job` - Join job room for progress updates
- `leave-job` - Leave job room
- `job-completed` - Notify server that job is completed (triggers cleanup)

### Progress Updates

- `progress-update` - Real-time progress information
- `system-notification` - System-wide notifications
- `job-statistics` - Job processing statistics

## Sample Data

### Progress Update Event Data

When listening to `progress-update`, you'll receive data in this format:

```javascript
{
  "jobId": "test_DigitalBankingPortal",
  "timestamp": "2025-10-23T14:31:04.266Z",
  "status": "completed", // "pending", "completed", "failed"
  "progress": 100, // 0-100
  "currentStep": "Final package created",
  "steps": [
    { "name": "Analyzing .NET project", "progress": 100 },
    { "name": "Converting C# to Java", "progress": 100 },
    { "name": "Generating Quarkus project", "progress": 100 },
    { "name": "Creating final package", "progress": 100 }
  ],
  "result": {
    "analysis": {
      "totalFiles": 36,
      "csharpFiles": 18,
      "linesOfCode": 811,
      "fileSize": "41.12 KB"
    },
    "conversion": {
      "totalConverted": 18,
      "totalFiles": 18,
      "successRate": 100
    },
    "zipFilename": "converted_test_DigitalBankingPortal_2025-10-23T14-31-04-237Z.zip"
  },
  "error": null, // Error message if failed
  "createdAt": "2025-10-23T14:30:26.510Z",
  "updatedAt": "2025-10-23T14:31:04.266Z",
  "completedAt": "2025-10-23T14:31:04.266Z",
  "failedAt": null
}
```

### File Conversion Progress Data

During file conversion, you'll receive detailed progress:

```javascript
{
  "jobId": "test_DigitalBankingPortal",
  "timestamp": "2025-10-23T14:30:53.399Z",
  "status": "pending",
  "progress": 40,
  "currentStep": "Converted 12/18 files (27s elapsed, ~13s remaining)",
  "filesConverted": 12,
  "totalFiles": 18,
  "elapsedTime": 27000, // milliseconds
  "estimatedTime": 13000, // milliseconds
  "steps": [
    { "name": "Analyzing .NET project", "progress": 100 },
    { "name": "Converting C# to Java", "progress": 40 },
    { "name": "Generating Quarkus project", "progress": 0 },
    { "name": "Creating final package", "progress": 0 }
  ]
}
```

## Example Client Code

### Local Development

```javascript
// Better approach - use environment variables or config
const serverUrl = process.env.SOCKET_URL || "http://localhost:8000";
const socket = io(serverUrl);

// Connect and join job room
socket.on("connect", () => {
  // Job ID naming conventions:
  // - Test conversion: 'test_DigitalBankingPortal'
  // - Custom conversion: 'convert_[filename]' (e.g., 'convert_MyProject')
  // - Uploaded file: 'convert_[original-filename]' (e.g., 'convert_MyApp-v1.0')

  socket.emit("join-job", "test_DigitalBankingPortal");
});

// Listen for progress updates
socket.on("progress-update", (data) => {
  console.log(`Progress: ${data.progress}% - ${data.currentStep}`);
  console.log(`Files: ${data.filesConverted || 0}/${data.totalFiles || 0}`);
  console.log(`Elapsed: ${Math.round((data.elapsedTime || 0) / 1000)}s`);

  if (data.status === "completed") {
    console.log("🎉 Conversion completed!");
    console.log(`📦 Zip file: ${data.result?.zipFilename}`);
  } else if (data.status === "failed") {
    console.log("❌ Conversion failed:", data.error);
  }
});

// Listen for system notifications
socket.on("system-notification", (data) => {
  console.log(`🔔 ${data.type.toUpperCase()}: ${data.message}`);
});

// Leave job room when done
socket.emit("leave-job", "test_DigitalBankingPortal");

// Notify server of job completion (triggers cleanup)
socket.emit("job-completed", "test_DigitalBankingPortal");

// Disconnect socket after job completion
socket.disconnect();
```

## Socket Cleanup

### Automatic Cleanup

The client automatically disconnects the socket after job completion:

```javascript
socket.on("progress-update", (data) => {
  if (data.status === "completed" || data.status === "failed") {
    // Wait 3 seconds then disconnect
    setTimeout(() => {
      socket.emit("job-completed", data.jobId);
      socket.emit("leave-job", data.jobId);
      socket.disconnect();
    }, 3000);
  }
});
```

### Manual Cleanup

```javascript
// Manual disconnect
function disconnect() {
  if (socket) {
    socket.emit("job-completed", currentJobId);
    socket.emit("leave-job", currentJobId);
    socket.disconnect();
  }
}
```

### Server-Side Cleanup

The server automatically handles cleanup when receiving `job-completed` events:

```javascript
socket.on("job-completed", (jobId) => {
  console.log(`📋 Job completed, cleaning up room: ${jobId}`);
  socket.leave(jobId);
  // Remove from client room tracking
});
```

## Job ID Naming Conventions

### Test Conversion

- **Job ID**: `test_DigitalBankingPortal`
- **Usage**: For testing with the sample DigitalBankingPortal project
- **Join**: `socket.emit('join-job', 'test_DigitalBankingPortal')`

### Custom File Conversion

- **Job ID**: `convert_[filename]`
- **Examples**:
  - `convert_MyProject` (for MyProject.zip)
  - `convert_MyApp-v1.0` (for MyApp-v1.0.zip)
  - `convert_EnterpriseApp` (for EnterpriseApp.zip)
- **Join**: `socket.emit('join-job', 'convert_MyProject')`

### Uploaded File Conversion

- **Job ID**: `convert_[original-filename-without-extension]`
- **Examples**:
  - Upload: `MyProject.zip` → Job ID: `convert_MyProject`
  - Upload: `MyApp-v1.0.zip` → Job ID: `convert_MyApp-v1.0`
  - Upload: `EnterpriseApp.zip` → Job ID: `convert_EnterpriseApp`

## Deployment Scenarios

### Local Development

- **Socket.IO URL**: `http://localhost:8000`
- **API Base**: `http://localhost:8000/api`
- **WebSocket Endpoint**: `ws://localhost:8000/socket.io/`

### Production Deployment Examples

#### Heroku

```javascript
const socket = io("https://your-app-name.herokuapp.com");
```

#### AWS/Google Cloud/Azure

```javascript
const socket = io("https://your-domain.com");
// or with custom port
const socket = io("https://your-domain.com:8000");
```

#### Docker Container

```javascript
const socket = io("https://your-domain.com");
// or if using custom port mapping
const socket = io("https://your-domain.com:3000");
```

#### Subdomain Setup

```javascript
const socket = io("https://api.your-domain.com");
// or
const socket = io("https://migration-tool.your-domain.com");
```

### Environment-Based Configuration

#### Server-Side (.env)

```bash
# Development
SOCKET_URL=http://localhost:8000
API_URL=http://localhost:8000

# Production
SOCKET_URL=https://your-domain.com
API_URL=https://your-domain.com
```

#### Client-Side Configuration

```javascript
// Auto-detect environment
const isDevelopment = window.location.hostname === "localhost";
const socketUrl = isDevelopment
  ? "http://localhost:8000"
  : "https://your-production-domain.com";

const socket = io(socketUrl);
```

#### React/Vue/Angular Environment

```javascript
// Using environment variables
const socket = io(process.env.REACT_APP_SOCKET_URL || "http://localhost:8000");
```

## Configuration

The WebSocket service is configured with:

- CORS enabled for all origins
- Support for GET and POST methods
- Automatic client tracking
- Room-based message targeting
- **HTTPS support** for production deployments

## Error Handling

- Automatic reconnection support
- Graceful error handling for failed connections
- Client cleanup on disconnect
- Service cleanup on server shutdown
