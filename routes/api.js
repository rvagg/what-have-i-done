import express from 'express';
import { fetchUserActivity, generateActivityReport } from '../lib/github-activity.js';
import { generateSummary } from '../lib/anthropic.js';
import { getCachedUsernames, addUsernamesToCache, removeUsernameFromCache } from '../lib/usernames-cache.js';
import {
  getProgressSession,
  addConnection,
  removeConnection,
  sendProgress,
  updateSessionProgress
} from '../lib/progress-tracker.js';

const router = express.Router();

// API route for progress updates using SSE
router.get('/progress', (req, res) => {
  const processToken = req.query.token || Date.now().toString();
  
  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  // Send a heartbeat every 1 second to keep the connection alive
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 1000);
  
  // Handle client disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    res.end();
  });
  
  // Get or create the progress session
  const options = {
    status: 'prepare',
    message: 'Setting up processing...',
    isMultiUser: req.query.multi === 'true',
    userCount: parseInt(req.query.users || '1', 10)
  };
  const session = getProgressSession(processToken, options);
  
  // Add this connection to the session
  addConnection(processToken, res);
  
  // Send initial status immediately
  sendProgress(res, session.message, session.status);
  
  // Clean up on disconnect
  req.on('close', () => {
    removeConnection(processToken, res);
  });
});

// API route for generating activity data
router.post('/activity', async (req, res) => {
  try {
    if (!req.appConfig?.githubToken) {
      return res.status(401).json({ error: 'GitHub token is required' });
    }

    const { username, startDate, enrich = false, format = 'json' } = req.body;
    
    if (!username || !startDate) {
      return res.status(400).json({ error: 'Username and start date are required' });
    }

    // Convert date string to Date object
    const since = new Date(startDate);
    if (isNaN(since.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Please use YYYY-MM-DD' });
    }

    // Fetch activity data
    const activity = await fetchUserActivity(username, since, req.appConfig.githubToken);
    
    // Generate enriched report if requested
    if (enrich) {
      await Promise.all([
        fetchUserActivity.enrichCommitContributions(activity, since, username, req.appConfig.githubToken),
        fetchUserActivity.enrichPullRequestData(activity, since, username, req.appConfig.githubToken)
      ]);
    }

    // Generate response based on requested format
    if (format === 'html') {
      const htmlReport = generateActivityReport(activity, since, username, 'html', enrich);
      res.json({ html: htmlReport });
    } else if (format === 'plain') {
      const plainReport = generateActivityReport(activity, since, username, 'plain', enrich);
      res.json({ text: plainReport });
    } else {
      // Default to JSON
      res.json(activity);
    }
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API route for generating activity summary with Anthropic
router.post('/summary', async (req, res) => {
  try {
    if (!req.appConfig?.anthropicKey) {
      return res.status(401).json({ error: 'Anthropic API key is required' });
    }

    const { activityText } = req.body;
    
    if (!activityText) {
      return res.status(400).json({ error: 'Activity text is required' });
    }

    const summary = await generateSummary(activityText, req.appConfig.anthropicKey);
    res.json({ summary });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API route for getting cached usernames
router.get('/usernames', async (req, res) => {
  try {
    const usernames = await getCachedUsernames();
    res.json({ usernames });
  } catch (error) {
    console.error('API Error getting usernames:', error);
    res.status(500).json({ error: error.message });
  }
});

// API route for adding usernames to cache
router.post('/usernames', async (req, res) => {
  try {
    const { usernames } = req.body;
    
    if (!usernames || !Array.isArray(usernames)) {
      return res.status(400).json({ error: 'Invalid usernames array' });
    }
    
    const success = await addUsernamesToCache(usernames);
    
    if (success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to add usernames to cache' });
    }
  } catch (error) {
    console.error('API Error adding usernames:', error);
    res.status(500).json({ error: error.message });
  }
});

// API route for removing a username from cache
router.delete('/usernames/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    
    const success = await removeUsernameFromCache(username);
    
    if (success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to remove username from cache' });
    }
  } catch (error) {
    console.error('API Error removing username:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;