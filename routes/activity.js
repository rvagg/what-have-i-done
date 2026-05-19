import express from 'express';
import { fetchUserActivity, generateActivityReport, fetchAdditionalReposActivity, mergeActivity } from '../lib/github-activity.js';
import { generateSummary } from '../lib/anthropic.js';
import { saveReport } from '../lib/reports/manager.js';
import { addUsernamesToCache, getCachedUsernames } from '../lib/usernames-cache.js';

const router = express.Router();

// Filter activity data by org inclusion and/or exclusion lists
function filterByOrgs(activity, includeOrgs, excludeOrgs) {
  const hasInclude = includeOrgs && includeOrgs.length > 0;
  const hasExclude = excludeOrgs && excludeOrgs.length > 0;
  if (!hasInclude && !hasExclude) return activity;

  const included = hasInclude ? new Set(includeOrgs.map(o => o.toLowerCase())) : null;
  const excluded = hasExclude ? new Set(excludeOrgs.map(o => o.toLowerCase())) : null;

  const isKept = (repo) => {
    const owner = repo.nameWithOwner.split('/')[0].toLowerCase();
    if (included && !included.has(owner)) return false;
    if (excluded && excluded.has(owner)) return false;
    return true;
  };

  return {
    pullRequests: activity.pullRequests.filter(pr => isKept(pr.repository)),
    reviews: activity.reviews.filter(r => isKept(r.repository)),
    issues: activity.issues.filter(i => isKept(i.repository)),
    commitsByRepo: activity.commitsByRepo.filter(c => isKept(c.repository)),
  };
}

// Parse comma-separated org exclusion string into array
function parseExcludeOrgs(excludeOrgsStr) {
  if (!excludeOrgsStr || !excludeOrgsStr.trim()) return [];
  return excludeOrgsStr.split(',').map(s => s.trim()).filter(Boolean);
}

// Parse comma-separated additional repos string into array of "owner/repo" strings
function parseAdditionalRepos(str) {
  if (!str || !str.trim()) return [];
  return str.split(',').map(s => s.trim()).filter(s => /^[^/]+\/[^/]+$/.test(s));
}

// Display form to generate activity report
router.get('/', async (req, res) => {
  if (!res.locals.hasGithubToken) {
    req.flash('error', 'GitHub token is required to view activity reports');
    return res.redirect('/settings');
  }
  
  // Get cached usernames for suggestions
  const cachedUsernames = await getCachedUsernames();
  
  const tokenScopes = req.appConfig?.tokenScopes || [];
  const hasRepoScope = tokenScopes.includes('repo');

  res.render('activity-form', {
    title: 'Generate Activity Report',
    username: req.query.username || '',
    startDate: req.query.startDate || '',
    cachedUsernames: cachedUsernames,
    excludedOrgs: req.appConfig?.excludedOrgs || [],
    hasRepoScope
  });
});

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

    const { username, usernames, startDate, endDate, enrich, processToken, includeOrgs, excludeOrgs, additionalRepos } = req.body;
    const includeOrgsList = parseExcludeOrgs(includeOrgs); // same parsing logic
    const excludeOrgsList = parseExcludeOrgs(excludeOrgs);
    const additionalReposList = parseAdditionalRepos(additionalRepos);

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

    // Convert date strings to Date objects
    const since = new Date(startDate);
    if (isNaN(since.getTime())) {
      req.flash('error', 'Invalid start date format. Please use YYYY-MM-DD');
      return res.redirect('/activity');
    }

    let until = null;
    if (endDate && endDate.trim()) {
      until = new Date(endDate);
      if (isNaN(until.getTime())) {
        req.flash('error', 'Invalid end date format. Please use YYYY-MM-DD');
        return res.redirect('/activity');
      }
      // Set to end of day so the end date is inclusive
      until.setHours(23, 59, 59, 999);
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
      const activity = await fetchUserActivity(currentUsername, since, req.appConfig.githubToken, until);
      console.log(`Basic activity data fetched for ${currentUsername}`);

      // Fetch and merge activity from additional private repos
      if (additionalReposList.length > 0) {
        console.log(`Fetching additional repos for ${currentUsername}: ${additionalReposList.join(', ')}`);
        const additionalActivity = await fetchAdditionalReposActivity(
          additionalReposList, currentUsername, since, req.appConfig.githubToken, until
        );
        mergeActivity(activity, additionalActivity);
        console.log(`Merged additional repo activity for ${currentUsername}`);
      }

      // Apply org/user filter BEFORE enrichment to avoid wasted API calls
      const filteredActivity = filterByOrgs(activity, includeOrgsList, excludeOrgsList);

      if (includeOrgsList.length > 0) {
        console.log(`Filtered to only orgs: ${includeOrgsList.join(', ')} for ${currentUsername}`);
      }
      if (excludeOrgsList.length > 0) {
        console.log(`Filtered out repos from: ${excludeOrgsList.join(', ')} for ${currentUsername}`);
      }

      // Generate enriched report if requested (runs on filtered data only)
      if (enrich === 'true') {
        console.log(`Starting enrichment process for ${currentUsername}`);
        await Promise.all([
          fetchUserActivity.enrichCommitContributions(filteredActivity, since, currentUsername, req.appConfig.githubToken, until),
          fetchUserActivity.enrichPullRequestData(filteredActivity, since, currentUsername, req.appConfig.githubToken, until)
        ]);
        console.log(`Enrichment complete for ${currentUsername}`);
      }

      // Generate reports for this user
      const htmlReport = generateActivityReport(filteredActivity, since, currentUsername, 'html', enrich === 'true', until, additionalReposList);
      const plainTextReport = generateActivityReport(filteredActivity, since, currentUsername, 'plain', enrich === 'true', until, additionalReposList);

      // Store the user data
      usersData.push({
        username: currentUsername,
        activity: filteredActivity,
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
    let summaryCompressionInfo = null;
    if (req.appConfig?.anthropicKey) {
      try {
        // Choose appropriate report text based on single or multi-user
        const reportText = isMultiUser ? consolidatedPlainText : usersData[0].plainTextReport;
        console.log('Generated plain text report for summary, length:', reportText.length);

        // Generate summary with appropriate context
        const result = await generateSummary(
          reportText,
          req.appConfig.anthropicKey,
          isMultiUser,
          usernameList,
          req.appConfig.claudeModel || 'claude-3-5-sonnet-latest' // Use configured model or default
        );
        summary = result.html;
        summaryCompressionInfo = result.compressionInfo;
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
      endDate: until ? until.toISOString() : null,
      summary,
      summaryCompressionInfo,
      htmlReport: isMultiUser ? consolidatedHtmlReport : usersData[0].htmlReport,
      plainTextReport: isMultiUser ? consolidatedPlainText : usersData[0].plainTextReport,
      // Include the full activity data for all users to allow regenerating summaries
      enrichedData: usersData.map(userData => ({
        username: userData.username,
        activity: userData.activity,
      })),
      includedOrgs: includeOrgsList,
      excludedOrgs: excludeOrgsList,
      additionalRepos: additionalReposList,
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
      endDate: until ? until.toISOString() : null,
      summary,
      summaryCompressionInfo,
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