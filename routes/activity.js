import express from 'express';
import { fetchUserActivity, generateActivityReport } from '../lib/github-activity.js';
import { generateSummary } from '../lib/anthropic.js';
import { saveReport } from '../lib/reports/manager.js';
import { addUsernamesToCache, getCachedUsernames } from '../lib/usernames-cache.js';
import { updateSessionProgress } from '../lib/progress-tracker.js';

const router = express.Router();

// Display form to generate activity report
router.get('/', async (req, res) => {
  if (!res.locals.hasGithubToken) {
    req.flash('error', 'GitHub token is required to view activity reports');
    return res.redirect('/settings');
  }
  
  // Get cached usernames for suggestions
  const cachedUsernames = await getCachedUsernames();
  
  res.render('activity-form', {
    title: 'Generate Activity Report',
    username: req.query.username || '',
    startDate: req.query.startDate || '',
    cachedUsernames: cachedUsernames
  });
});

// Start processing in the background and update progress
router.post('/process', async (req, res) => {
  try {
    console.log('**** PROCESS ENDPOINT CALLED ****');
    console.log('Request body:', req.body);
    
    // This is a non-blocking endpoint - it returns immediately while processing continues
    const { username, usernames, startDate, enrich, processToken } = req.body;
    
    console.log('Process token:', processToken);
    console.log('Username:', username);
    console.log('Usernames:', usernames);
    console.log('Start date:', startDate);
    
    if (!processToken) {
      console.error('Missing process token');
      return res.status(400).send('Missing process token');
    }
    
    if (!req.appConfig?.githubToken) {
      console.error('Missing GitHub token');
      updateSessionProgress(processToken, 'GitHub token is missing or invalid', 'error');
      return res.status(401).send('GitHub token required');
    }
    
    // Start processing in background - this will not block the response
    console.log('Starting background processing...');
    processActivityReport(req.body, req.appConfig, processToken)
      .catch(error => {
        console.error('Background processing error:', error);
        updateSessionProgress(processToken, `Error: ${error.message}`, 'error');
      });
    
    // Return immediately
    console.log('Returning 202 response');
    res.status(202).send('Processing started');
  } catch (error) {
    console.error('Process error:', error);
    res.status(500).send('Error starting processing');
  }
});

// Process activity data and send progress updates
async function processActivityReport(formData, appConfig, processToken) {
  try {
    const { username, usernames, startDate, enrich } = formData;
    
    // Validate inputs
    if (!startDate) {
      updateSessionProgress(processToken, 'Error: Start date is required', 'error');
      throw new Error('Start date is required');
    }
    
    // Process usernames
    let usernameList = [];
    if (username && username.trim()) {
      usernameList.push(username.trim());
    }
    if (usernames && usernames.trim()) {
      const additionalUsernames = usernames.trim().split(',').map(name => name.trim()).filter(Boolean);
      usernameList = [...new Set([...usernameList, ...additionalUsernames])];
    }
    
    if (usernameList.length === 0) {
      updateSessionProgress(processToken, 'Error: At least one username is required', 'error');
      throw new Error('At least one username is required');
    }
    
    const isMultiUser = usernameList.length > 1;
    
    // Parse date
    const since = new Date(startDate);
    if (isNaN(since.getTime())) {
      updateSessionProgress(processToken, 'Error: Invalid date format', 'error');
      throw new Error('Invalid date format');
    }
    
    // Initialize collection for user data
    const usersData = [];
    
    // Progress: starting
    updateSessionProgress(processToken, 'Connecting to GitHub API...', 'fetch');
    console.log(`Processing report for ${usernameList.length} users with token ${processToken}`);
    
    // Fetch data for all users
    for (let i = 0; i < usernameList.length; i++) {
      const currentUsername = usernameList[i];
      
      // Update progress - fetching data
      updateSessionProgress(
        processToken, 
        `Fetching data for ${isMultiUser ? `user ${i+1}/${usernameList.length}` : '@' + currentUsername}...`, 
        'fetch'
      );
      console.log(`Fetching GitHub data for ${currentUsername}`);
      
      // Fetch activity data
      const activity = await fetchUserActivity(currentUsername, since, appConfig.githubToken);
      console.log(`Basic GitHub data fetched for ${currentUsername}`);
      
      // Update progress - enriching if needed
      if (enrich === 'true') {
        updateSessionProgress(
          processToken, 
          `Enriching data for ${isMultiUser ? `user ${i+1}/${usernameList.length}` : '@' + currentUsername}...`, 
          'enrich'
        );
        console.log(`Enriching data for ${currentUsername}`);
        
        // Run enrichment processes
        await Promise.all([
          fetchUserActivity.enrichCommitContributions(activity, since, currentUsername, appConfig.githubToken),
          fetchUserActivity.enrichPullRequestData(activity, since, currentUsername, appConfig.githubToken)
        ]);
        console.log(`Data enrichment complete for ${currentUsername}`);
      }
      
      // Update progress - generating report
      updateSessionProgress(
        processToken, 
        `Generating report for ${isMultiUser ? `user ${i+1}/${usernameList.length}` : '@' + currentUsername}...`, 
        'report'
      );
      console.log(`Generating reports for ${currentUsername}`);
      
      // Generate reports for this user
      const htmlReport = generateActivityReport(activity, since, currentUsername, 'html', enrich === 'true');
      const plainTextReport = generateActivityReport(activity, since, currentUsername, 'plain', enrich === 'true');
      console.log(`Reports generated for ${currentUsername}`);
      
      // Store the user data
      usersData.push({
        username: currentUsername,
        activity,
        htmlReport,
        plainTextReport
      });
    }
    
    // Multi-user consolidation if needed
    if (isMultiUser) {
      updateSessionProgress(processToken, 'Consolidating multi-user reports...', 'report');
      console.log('Consolidating multi-user data');
    }
    
    // AI summary if possible
    if (appConfig?.anthropicKey) {
      updateSessionProgress(processToken, 'Generating AI summary...', 'ai');
      console.log('AI summary would be generated by the main handler');
    }
    
    // Complete
    updateSessionProgress(processToken, 'Processing complete! Redirecting...', 'complete');
    console.log('Background processing complete for token:', processToken);
    
    return usersData;
  } catch (error) {
    console.error(`Process activity error for token ${processToken}:`, error);
    updateSessionProgress(processToken, `Error: ${error.message}`, 'error');
    throw error;
  }
}

// Generate and display activity report
router.post('/', async (req, res) => {
  try {
    if (!req.appConfig?.githubToken) {
      req.flash('error', 'GitHub token is required to generate reports');
      return res.redirect('/settings');
    }
    
    console.log('Using GitHub token:', req.appConfig.githubToken ? 
      `${req.appConfig.githubToken.substring(0, 5)}...${req.appConfig.githubToken.substring(req.appConfig.githubToken.length - 4)}` : 
      'No token');

    const { username, usernames, startDate, enrich, processToken } = req.body;
    
    // Process usernames (both from direct field and the hidden comma-separated field)
    let usernameList = [];
    
    // Add username from main field if provided
    if (username && username.trim()) {
      usernameList.push(username.trim());
    }
    
    // Add usernames from comma-separated list
    if (usernames && usernames.trim()) {
      const additionalUsernames = usernames.trim().split(',').map(name => name.trim()).filter(Boolean);
      // Use Set to deduplicate
      usernameList = [...new Set([...usernameList, ...additionalUsernames])];
    }
    
    if (usernameList.length === 0 || !startDate) {
      req.flash('error', 'At least one username and start date are required');
      return res.redirect('/activity');
    }
    
    console.log(`Generating report for ${usernameList.length} user(s):`, usernameList.join(', '));

    // Convert date string to Date object
    const since = new Date(startDate);
    if (isNaN(since.getTime())) {
      req.flash('error', 'Invalid date format. Please use YYYY-MM-DD');
      return res.redirect('/activity');
    }

    // For future real-time progress updates, we'd use something like:
    // const progressEmitter = new EventEmitter();
    // const progressId = req.body.progressId;
    
    // Multi-user support
    const isMultiUser = usernameList.length > 1;
    const usersData = [];
    
    // Fetch data for all users
    for (let i = 0; i < usernameList.length; i++) {
      const currentUsername = usernameList[i];
      
      console.log(`Starting GitHub data fetch for user ${i+1}/${usernameList.length}: ${currentUsername}`);
      
      // Fetch activity data
      const activity = await fetchUserActivity(currentUsername, since, req.appConfig.githubToken);
      console.log(`Basic activity data fetched for ${currentUsername}`);
      
      // Generate enriched report if requested
      if (enrich === 'true') {
        console.log(`Starting enrichment process for ${currentUsername}`);
        await Promise.all([
          fetchUserActivity.enrichCommitContributions(activity, since, currentUsername, req.appConfig.githubToken),
          fetchUserActivity.enrichPullRequestData(activity, since, currentUsername, req.appConfig.githubToken)
        ]);
        console.log(`Enrichment complete for ${currentUsername}`);
      }
      
      // Generate reports for this user
      const htmlReport = generateActivityReport(activity, since, currentUsername, 'html', enrich === 'true');
      const plainTextReport = generateActivityReport(activity, since, currentUsername, 'plain', enrich === 'true');
      
      // Store the user data
      usersData.push({
        username: currentUsername,
        activity,
        htmlReport,
        plainTextReport
      });
    }
    
    // Generate consolidated report for multi-user case
    let consolidatedHtmlReport = '';
    let consolidatedPlainText = '';
    
    if (isMultiUser) {
      // Create a consolidated HTML report with sections for each user
      consolidatedHtmlReport = `
        <div class="multi-user-report">
          <h2>Activity Report for ${usernameList.length} Users</h2>
          <p>Showing activity since ${since.toLocaleDateString()}</p>
          
          <ul class="nav nav-tabs mb-4" id="userTabs" role="tablist">
            ${usersData.map((userData, index) => `
              <li class="nav-item" role="presentation">
                <button class="nav-link ${index === 0 ? 'active' : ''}" 
                  id="user-tab-${index}" data-bs-toggle="tab" 
                  data-bs-target="#user-content-${index}" type="button" 
                  role="tab" aria-controls="user-content-${index}" 
                  aria-selected="${index === 0 ? 'true' : 'false'}">
                  @${userData.username}
                </button>
              </li>
            `).join('')}
          </ul>
          
          <div class="tab-content" id="userTabsContent">
            ${usersData.map((userData, index) => `
              <div class="tab-pane fade ${index === 0 ? 'show active' : ''}" 
                id="user-content-${index}" role="tabpanel" 
                aria-labelledby="user-tab-${index}">
                ${userData.htmlReport}
              </div>
            `).join('')}
          </div>
        </div>
      `;
      
      // Create consolidated plain text with clear sections for the AI summary
      consolidatedPlainText = usersData.map(userData => 
        `==== USER: @${userData.username} ====\n\n${userData.plainTextReport}\n\n`
      ).join('\n');
    }
    
    // Generate summary if Anthropic key is available
    let summary = null;
    if (req.appConfig?.anthropicKey) {
      try {
        // Choose appropriate report text based on single or multi-user
        const reportText = isMultiUser ? consolidatedPlainText : usersData[0].plainTextReport;
        console.log('Generated plain text report for summary, length:', reportText.length);
        
        // Generate summary with appropriate context
        summary = await generateSummary(
          reportText, 
          req.appConfig.anthropicKey,
          isMultiUser,
          usernameList,
          req.appConfig.claudeModel || 'claude-3-5-sonnet-latest' // Use configured model or default
        );
      } catch (summaryError) {
        console.error('Error generating summary:', summaryError);
        // Don't fail the entire request if summary generation fails
        summary = `<div class="summary"><h3>AI Summary Error</h3><p>There was an error generating the AI summary: ${summaryError.message}</p></div>`;
      }
    }

    // Prepare report data with full enriched activity data for later reuse
    const reportData = {
      usernames: usernameList,
      isMultiUser,
      startDate,
      summary,
      htmlReport: isMultiUser ? consolidatedHtmlReport : usersData[0].htmlReport,
      plainTextReport: isMultiUser ? consolidatedPlainText : usersData[0].plainTextReport,
      // Include the full activity data for all users to allow regenerating summaries
      enrichedData: usersData.map(userData => ({
        username: userData.username,
        activity: userData.activity,
      })),
      generatedAt: new Date().toISOString(),
      hasSummary: !!summary
    };
    
    // Automatically save the report
    try {
      console.log('Automatically saving report for', usernameList.join(', '));
      const reportId = await saveReport(reportData);
      console.log('Report saved with ID:', reportId);
      
      // Add usernames to cache for future autocomplete
      await addUsernamesToCache(usernameList);
      console.log('Added usernames to cache:', usernameList);
      
      // Set a flag to show the report was saved
      req.flash('success', 'Report saved successfully. You can access it later from the Reports list.');
    } catch (saveError) {
      console.error('Error saving report:', saveError);
      req.flash('warning', `Report was generated but could not be saved: ${saveError.message}`);
    }
    
    // Render the report page
    res.render('activity-report', {
      title: isMultiUser 
        ? `GitHub Activity for ${usernameList.length} Users` 
        : `GitHub Activity for @${usernameList[0]}`,
      usernames: usernameList,
      isMultiUser,
      startDate,
      summary,
      htmlReport: isMultiUser ? consolidatedHtmlReport : usersData[0].htmlReport,
      hasAnthropicKey: !!req.appConfig?.anthropicKey,
      autoSaved: true
    });
  } catch (error) {
    console.error('Error generating activity report:', error);
    req.flash('error', `Failed to generate report: ${error.message}`);
    res.redirect('/activity');
  }
});

export default router;