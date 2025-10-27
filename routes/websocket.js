const express = require('express');
const router = express.Router();
const websocket = require('../websocket');
const { validateWebSocketNotification } = require('../middleware/validation');

// Get WebSocket statistics
router.get('/stats', (req, res) => {
  try {
    const stats = {
      connectedClients: websocket.getConnectedClientsCount(),
      connectedClientsList: websocket.getConnectedClients(),
      timestamp: new Date().toISOString()
    };
    
    res.status(200).json({
      success: true,
      stats: stats
    });
  } catch (error) {
    console.error('Error getting WebSocket stats:', error);
    res.status(500).json({
      success: false,
      error: 'Error getting WebSocket statistics',
      details: error.message
    });
  }
});

// Get clients in a specific room
router.get('/room/:roomId/clients', (req, res) => {
  try {
    const roomId = req.params.roomId;
    const clientCount = websocket.getClientsInRoom(roomId);
    
    res.status(200).json({
      success: true,
      roomId: roomId,
      clientCount: clientCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting room clients:', error);
    res.status(500).json({
      success: false,
      error: 'Error getting room clients',
      details: error.message
    });
  }
});

// Send system notification with validation
router.post('/notify', validateWebSocketNotification, (req, res) => {
  try {
    const { message, type = 'info' } = req.body;
    
    websocket.emitSystemNotification(message, type);
    
    res.status(200).json({
      success: true,
      message: 'Notification sent to all connected clients',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({
      success: false,
      error: 'Error sending notification',
      details: error.message
    });
  }
});

// Test WebSocket connection
router.get('/test', (req, res) => {
  try {
    websocket.emitSystemNotification('WebSocket test message', 'info');
    
    res.status(200).json({
      success: true,
      message: 'Test notification sent to all connected clients',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error testing WebSocket:', error);
    res.status(500).json({
      success: false,
      error: 'Error testing WebSocket',
      details: error.message
    });
  }
});

module.exports = router;
