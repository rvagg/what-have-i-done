/**
 * Module for tracking progress of long-running operations
 * Provides a shared store for progress sessions and functions to update them
 */

// Store active progress sessions
const progressSessions = new Map();

/**
 * Helper function to send progress updates to a single client
 * @param {Object} res - Express response object
 * @param {string} message - Progress message
 * @param {string} status - Progress status
 */
export function sendProgress(res, message, status) {
  res.write(`data: ${JSON.stringify({ message, status })}\n\n`);
}

/**
 * Create or get a progress session
 * @param {string} token - The unique token for this session
 * @param {Object} options - Session options
 * @returns {Object} The progress session
 */
export function getProgressSession(token, options = {}) {
  if (!progressSessions.has(token)) {
    progressSessions.set(token, {
      connections: [],
      status: options.status || 'prepare',
      message: options.message || 'Setting up processing...',
      isMultiUser: options.isMultiUser || false,
      userCount: options.userCount || 1,
      startTime: Date.now()
    });
  }
  
  return progressSessions.get(token);
}

/**
 * Add a client connection to a progress session
 * @param {string} token - The session token
 * @param {Object} res - Express response object
 * @returns {Object} The updated session
 */
export function addConnection(token, res) {
  const session = getProgressSession(token);
  session.connections.push(res);
  return session;
}

/**
 * Remove a client connection from a progress session
 * @param {string} token - The session token
 * @param {Object} res - Express response object
 */
export function removeConnection(token, res) {
  if (!progressSessions.has(token)) return;
  
  const session = progressSessions.get(token);
  session.connections = session.connections.filter(conn => conn !== res);
  
  // If no connections left and processing is complete, clean up the session
  if (session.connections.length === 0 && 
      (session.status === 'complete' || session.status === 'error')) {
    setTimeout(() => {
      progressSessions.delete(token);
    }, 5000); // Keep session around briefly in case of reconnection
  }
}

/**
 * Helper function to update progress for all clients in a session
 * @param {string} token - The session token
 * @param {string} message - Progress message
 * @param {string} status - Progress status
 */
export function updateSessionProgress(token, message, status) {
  if (!progressSessions.has(token)) {
    getProgressSession(token, { status, message });
    return;
  }
  
  const session = progressSessions.get(token);
  session.message = message;
  session.status = status;
  
  // Send to all active connections
  session.connections.forEach(res => {
    sendProgress(res, message, status);
  });
  
  console.log(`[Progress] Token: ${token}, Status: ${status}, Message: ${message}`);
}