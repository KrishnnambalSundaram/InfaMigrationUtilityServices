require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require("body-parser");
const { createServer } = require('http');
const app = express();
const server = createServer(app);

// Import middleware
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { securityHeaders, generalLimiter, requestSizeLimiter } = require('./middleware/security');
const { logger } = require('./utils/logger');

// Import WebSocket services
const websocket = require('./websocket');


const PORT = process.env.PORT || 3001;

// Security middleware
app.use(securityHeaders);
app.use(requestSizeLimiter);

// Middleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(express.static('public'));

// Rate limiting (scope to API routes to avoid interfering with Socket.IO at /socket.io)
app.use('/api', generalLimiter);

// Routes
const uploadRoutes = require('./routes/uploads');
const conversionRoutes = require('./routes/conversion');
const idmcRoutes = require('./routes/idmc');
const loginRoute = require('./routes/loginRoute');
const websocketRoutes = require('./routes/websocket');

// API End Points
app.use('/api', uploadRoutes);
app.use('/api', conversionRoutes);
  // Backward-compatible mount to support README path `/api/conversion/*`
  app.use('/api/conversion', conversionRoutes);
app.use('/api/idmc', idmcRoutes);
app.use('/api/auth', loginRoute);
app.use('/api/websocket', websocketRoutes);

app.get('/', (req, res) => {
  res.json({ 
    status: 'Oracle → Snowflake & IDMC Migration Tool API Ready',
    description: 'Oracle PL/SQL to Snowflake SQL/JavaScript and IDMC Migration Utility using LLM-based conversion',
    endpoints: {
      // File Upload Routes
      upload: {
        method: 'POST',
        url: '/api/upload',
        description: 'Upload ZIP file (simple file upload only)'
      },
      download: {
        method: 'POST', 
        url: '/api/download',
        description: 'Download converted zip file (requires JWT token)',
        headers: {
          'Authorization': 'Bearer <your-jwt-token>',
          'Content-Type': 'application/json'
        },
        body: {
          filename: 'converted_test_DigitalBankingPortal_2024-01-15T10-30-45-123Z.zip'
        }
      },
      // Conversion Routes  
      test: {
        method: 'POST',
        url: '/api/test',
        description: 'Test Oracle → Snowflake migration using sample zip file'
      },
      convertUnified: {
        method: 'POST',
        url: '/api/convert-unified',
        description: 'Unified convert: inputType (zip|single), target (snowflake|idmc)',
        body: { inputType: 'zip|single', target: 'snowflake|idmc', sourceType: 'oracle|redshift|auto', zipFilePath: '/abs/path.zip', sourceCode: '...', fileName: 'input.sql' }
      },
      progress: {
        method: 'GET',
        url: '/api/progress/:jobId',
        description: 'Get real-time progress status',
        note: 'Job ID format: convert_[filename]'
      },
      // IDMC Conversion Routes
      idmcBatch: {
        method: 'POST',
        url: '/api/idmc/batch',
        description: 'Unified batch processing: inputType zip|single',
        body: { inputType: 'zip|single', zipFilePath: '/abs/path.zip', script: '...', fileName: 'run_script.bat', scriptType: 'oracle|redshift' }
      },
      // WebSocket Routes
      websocketStats: {
        method: 'GET',
        url: '/api/websocket/stats',
        description: 'Get WebSocket connection statistics'
      },
      websocketTest: {
        method: 'GET',
        url: '/api/websocket/test',
        description: 'Test WebSocket connection by sending notification'
      },
      websocketNotify: {
        method: 'POST',
        url: '/api/websocket/notify',
        description: 'Send notification to all connected clients',
        body: { message: 'Your message', type: 'info' }
      }
    },
    organization: {
      uploadRoutes: 'Handles Oracle file uploads and Snowflake conversion downloads',
      conversionRoutes: 'Handles Oracle PL/SQL to Snowflake SQL/JavaScript conversion with progress tracking',
      idmcRoutes: 'Handles Oracle/Redshift to IDMC mapping summary conversions'
    }
  });
});

// Initialize WebSocket service
websocket.initialize(server);

// Make websocket available globally for progress updates
global.websocket = websocket;

// Error handling middleware (must be last)
app.use(notFound);
app.use(errorHandler);

const start = async()=>{
  try {
    server.listen(PORT, () => {
      logger.info(`🚀 Server listening on port ${PORT}`, {
        port: PORT,
        timestamp: new Date().toISOString()
      });
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

start()