// GraphQL queries
const userActivityGraphql = `
  query($cursor: String, $login: String!, $since: DateTime!, $until: DateTime) {
    user(login: $login) {
      contributionsCollection(from: $since, to: $until) {
        totalCommitContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalIssueContributions
        pullRequestContributions(first: 100, after: $cursor) {
          nodes {
            pullRequest {
              title
              number
              repository { nameWithOwner }
              createdAt
              updatedAt
              mergedAt
              closedAt
              isDraft
              state
              commits(first: 1) { totalCount }
              additions
              deletions
              comments { totalCount }
              reviews { totalCount }
              body
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
        pullRequestReviewContributions(first: 100, after: $cursor) {
          nodes {
            pullRequestReview {
              createdAt
              updatedAt
              state
              comments { totalCount }
              repository { nameWithOwner }
              pullRequest {
                number
                title
                author { login }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
        commitContributionsByRepository(maxRepositories: 100) {
          repository { nameWithOwner }
          contributions {
            totalCount
          }
        }
        issueContributions(first: 100, after: $cursor) {
          nodes {
            issue {
              title
              number
              repository { nameWithOwner }
              createdAt
              updatedAt
              closedAt
              comments { totalCount }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const contributionsByRepoGraphql = `
  query($owner: String!, $repo: String!, $commitCursor: String, $since: GitTimestamp!, $until: GitTimestamp) {
    repository(owner: $owner, name: $repo) {
      defaultBranchRef {
        target {
          ... on Commit {
            history(since: $since, until: $until, first: 100, after: $commitCursor, author: {id: "{{authorId}}"}) {
              nodes {
                messageHeadline
                messageBody
                committedDate
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }
    }
  }
`;

const prCommentsGraphql = `
  query($owner: String!, $repo: String!, $prNumber: Int!, $commentCursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $prNumber) {
        comments(first: 100, after: $commentCursor) {
          nodes {
            author { login }
            bodyText
            createdAt
            reactionGroups {
              content
              reactors { totalCount }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const prReviewDetailsGraphql = `
  query($owner: String!, $repo: String!, $prNumber: Int!, $reviewCursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $prNumber) {
        reviews(first: 100, after: $reviewCursor) {
          nodes {
            author { login }
            state
            createdAt
            comments(first: 100) {
              nodes {
                bodyText
                path
                position
                diffHunk
                createdAt
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const prChangedFilesGraphql = `
  query($owner: String!, $repo: String!, $prNumber: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $prNumber) {
        files(first: 100) {
          nodes {
            path
            additions
            deletions
            changeType
          }
        }
      }
    }
  }
`;

const prTimelineGraphql = `
  query($owner: String!, $repo: String!, $prNumber: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $prNumber) {
        timelineItems(first: 100) {
          nodes {
            __typename
            ... on ReadyForReviewEvent {
              actor { login }
              createdAt
            }
            ... on ReviewRequestedEvent {
              actor { login }
              createdAt
              requestedReviewer {
                ... on User { login }
              }
            }
            ... on MergedEvent {
              actor { login }
              createdAt
              commit { oid }
            }
          }
        }
      }
    }
  }
`;

const repoInfoGraphql = `
  query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      description
      repositoryTopics(first: 10) {
        nodes {
          topic { name }
        }
      }
    }
  }
`;

const repoSearchPRsGraphql = `
  query($searchQuery: String!, $cursor: String) {
    search(query: $searchQuery, type: ISSUE, first: 100, after: $cursor) {
      nodes {
        ... on PullRequest {
          title
          number
          repository { nameWithOwner }
          createdAt
          updatedAt
          mergedAt
          closedAt
          isDraft
          state
          commits(first: 1) { totalCount }
          additions
          deletions
          comments { totalCount }
          reviews { totalCount }
          body
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const repoSearchIssuesGraphql = `
  query($searchQuery: String!, $cursor: String) {
    search(query: $searchQuery, type: ISSUE, first: 100, after: $cursor) {
      nodes {
        ... on Issue {
          title
          number
          repository { nameWithOwner }
          createdAt
          updatedAt
          closedAt
          comments { totalCount }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const userIdGraphql = `
  query($login: String!) {
    user(login: $login) {
      id
    }
  }
`;

// Fetch data from GitHub API with retry logic for transient errors
async function fetchQuery(query, variables, token, retryCount = 0) {
  if (!token) {
    throw new Error('GitHub token is required');
  }

  const maxRetries = 3;
  const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff: 1s, 2s, 4s

  console.log('Making GitHub API request with token:', token.substring(0, 5) + '...');
  
  try {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'User-Agent': 'what-have-i-done',
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({ query, variables })
    });

    // Check for rate limit (429) and wait for reset
    if (response.status === 429) {
      const resetTime = response.headers.get('x-ratelimit-reset');
      const now = Math.floor(Date.now() / 1000);
      const waitTime = resetTime ? (parseInt(resetTime) - now + 10) * 1000 : 60000; // Wait until reset + 10s buffer, or 60s default
      
      console.log(`GitHub API rate limit exceeded. Waiting ${Math.round(waitTime/1000)}s until reset...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return fetchQuery(query, variables, token, retryCount); // Don't increment retryCount for rate limits
    }

    // Check for transient errors that should be retried
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      if (retryCount < maxRetries) {
        console.log(`GitHub API returned ${response.status} ${response.statusText}, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries + 1})`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return fetchQuery(query, variables, token, retryCount + 1);
      } else {
        throw new Error(`GitHub API error after ${maxRetries + 1} attempts: ${response.status} ${response.statusText}`);
      }
    }

    if (response.status !== 200) {
      throw new Error(`Failed to fetch user activity data: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.errors) {
      // Check if it's a rate limit error in the GraphQL response
      const errorMessage = data.errors[0].message;
      if (errorMessage.includes('API rate limit exceeded')) {
        console.log(`GitHub API rate limit exceeded via GraphQL error. Waiting 60s...`);
        await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 60 seconds
        return fetchQuery(query, variables, token, retryCount); // Don't increment retryCount for rate limits
      }
      throw new Error(`Failed to fetch user activity data: ${errorMessage}`);
    }
    return data;
  } catch (error) {
    // Retry on network errors
    if ((error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'UND_ERR_SOCKET' ||
         error.message.includes('fetch failed') || error.message.includes('terminated') || error.cause?.code === 'UND_ERR_SOCKET') && retryCount < maxRetries) {
      console.log(`Network error: ${error.message}, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries + 1})`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return fetchQuery(query, variables, token, retryCount + 1);
    }
    throw error;
  }
}

// Safe wrapper for fetchQuery that handles private repo access gracefully
async function fetchQuerySafe(query, variables, token, defaultReturn = null) {
  try {
    return await fetchQuery(query, variables, token);
  } catch (error) {
    // Check if it's a private repo access error
    if (error.message.includes('Forbidden') || 
        error.message.includes('Not Found') || 
        error.message.includes('Resource not accessible')) {
      console.log(`Skipping private/inaccessible repository: ${variables.owner}/${variables.repo}`);
      return defaultReturn;
    }
    // Re-throw other errors
    throw error;
  }
}

// Fetch all basic activity data for a user
export async function fetchUserActivity(login, since, token, until = null) {
  const activity = {
    pullRequests: [],
    reviews: [],
    issues: [],
    commitsByRepo: []
  };
  let hasNextPage = true;
  let cursor = null;

  const from = new Date(since);
  from.setMonth(from.getMonth() - 1);

  const variables = { cursor, login, since: from.toISOString() };
  if (until) {
    variables.until = new Date(until).toISOString();
  }

  while (hasNextPage) {
    variables.cursor = cursor;
    const data = await fetchQuery(userActivityGraphql, variables, token);
    const contributions = data.data.user.contributionsCollection;
    activity.pullRequests = activity.pullRequests.concat(
      contributions.pullRequestContributions.nodes.map((n) => n.pullRequest)
    );
    activity.reviews = activity.reviews.concat(
      contributions.pullRequestReviewContributions.nodes.map((n) => n.pullRequestReview)
    );
    activity.issues = activity.issues.concat(
      contributions.issueContributions.nodes.map((n) => n.issue)
    );
    if (!activity.commitsByRepo.length) {
      activity.commitsByRepo = contributions.commitContributionsByRepository;
    }
    const pageInfo = contributions.pullRequestContributions.pageInfo;
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  // Filter contributions to include only those updated within the specified date range
  activity.pullRequests = activity.pullRequests.filter((pr) => new Date(pr.updatedAt) >= since);
  activity.reviews = activity.reviews.filter((review) => new Date(review.updatedAt) >= since);
  activity.issues = activity.issues.filter((issue) => new Date(issue.updatedAt) >= since);

  if (until) {
    activity.pullRequests = activity.pullRequests.filter((pr) => new Date(pr.updatedAt) <= until);
    activity.reviews = activity.reviews.filter((review) => new Date(review.updatedAt) <= until);
    activity.issues = activity.issues.filter((issue) => new Date(issue.updatedAt) <= until);
  }

  return activity;
}

// Fetch the unique internal GitHub ID for a user
async function fetchUniqueIdForUser(login, token) {
  const data = await fetchQuery(userIdGraphql, { login }, token);
  return data.data.user.id;
}

async function fetchRepoInfo(owner, name, token) {
  const data = await fetchQuerySafe(repoInfoGraphql, { owner, name }, token, { data: null });
  if (!data || !data.data) {
    return null; // Return null if repository is not accessible
  }
  return data.data?.repository;
}

// Fetch commit contributions for a repository
async function fetchCommitContributionsForRepo(owner, repo, since, authorId, token, until = null) {
  const query = contributionsByRepoGraphql.replace('{{authorId}}', authorId);
  let allCommits = [];
  let commitCursor = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const variables = { owner, repo, commitCursor, since: since.toISOString() };
    if (until) {
      variables.until = new Date(until).toISOString();
    }
    const data = await fetchQuerySafe(query, variables, token, { data: null });
    if (!data || !data.data) {
      return []; // Return empty array if repository is not accessible
    }
    const repoData = data.data.repository;
    if (!repoData || !repoData.defaultBranchRef || !repoData.defaultBranchRef.target) {
      break;
    }
    const history = repoData.defaultBranchRef.target.history;
    allCommits = allCommits.concat(history.nodes);
    hasNextPage = history.pageInfo.hasNextPage;
    commitCursor = history.pageInfo.endCursor;
  }
  return allCommits;
}

async function enrichCommitContributions(activity, since, author, token, until = null) {
  const authorId = await fetchUniqueIdForUser(author, token);
  const queue = [];
  for (const repoContribution of activity.commitsByRepo) {
    const repoName = repoContribution.repository.nameWithOwner;
    const [owner, repo] = repoName.split('/');
    queue.push(
      (async () => {
        const extraCommits = await fetchCommitContributionsForRepo(owner, repo, since, authorId, token, until);
        repoContribution.contributions.nodes = extraCommits;
        repoContribution.contributions.directCommits = extraCommits.length;
        repoContribution.repoInfo = await fetchRepoInfo(owner, repo, token);
      })()
    );
  }
  await Promise.all(queue);
  return activity;
}
// Attach to the fetchUserActivity function
fetchUserActivity.enrichCommitContributions = enrichCommitContributions;

async function fetchPRComments(owner, repo, prNumber, token) {
  let allComments = [];
  let commentCursor = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const data = await fetchQuerySafe(prCommentsGraphql, { owner, repo, prNumber, commentCursor }, token, { data: null });
    if (!data || !data.data) {
      return []; // Return empty array if repository is not accessible
    }
    const comments = data.data?.repository?.pullRequest?.comments;
    if (!comments) {
      break;
    }
    allComments = allComments.concat(comments.nodes);
    hasNextPage = comments.pageInfo.hasNextPage;
    commentCursor = comments.pageInfo.endCursor;
  }
  return allComments;
}

async function fetchPRReviewDetails(owner, repo, prNumber, token) {
  let allReviewDetails = [];
  let reviewCursor = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const data = await fetchQuerySafe(prReviewDetailsGraphql, { owner, repo, prNumber, reviewCursor }, token, { data: null });
    if (!data || !data.data) {
      return []; // Return empty array if repository is not accessible
    }
    const reviews = data.data?.repository?.pullRequest?.reviews;
    if (!reviews) {
      break;
    }
    allReviewDetails = allReviewDetails.concat(reviews.nodes);
    hasNextPage = reviews.pageInfo.hasNextPage;
    reviewCursor = reviews.pageInfo.endCursor;
  }
  return allReviewDetails;
}

async function fetchPRChangedFiles(owner, repo, prNumber, token) {
  const data = await fetchQuerySafe(prChangedFilesGraphql, { owner, repo, prNumber }, token, { data: null });
  if (!data || !data.data) {
    return []; // Return empty array if repository is not accessible
  }
  return data.data?.repository?.pullRequest?.files?.nodes || [];
}

async function fetchPRTimeline(owner, repo, prNumber, token) {
  const data = await fetchQuerySafe(prTimelineGraphql, { owner, repo, prNumber }, token, { data: null });
  if (!data || !data.data) {
    return []; // Return empty array if repository is not accessible
  }
  return data.data?.repository?.pullRequest?.timelineItems?.nodes || [];
}

async function enrichPullRequestData(activity, since, login, token, until = null) {
  const queue = [];
  for (const pr of activity.pullRequests) {
    const owner = pr.repository.nameWithOwner.split('/')[0];
    const repo = pr.repository.nameWithOwner.split('/')[1];
    queue.push(
      (async () => {
        const [comments, reviewDetails, changedFiles, timelineItems] = await Promise.all([
          fetchPRComments(owner, repo, pr.number, token),
          fetchPRReviewDetails(owner, repo, pr.number, token),
          fetchPRChangedFiles(owner, repo, pr.number, token),
          fetchPRTimeline(owner, repo, pr.number, token)
        ]);

        pr.commentDetails = comments.filter((comment) => {
          const d = new Date(comment.createdAt);
          return d >= since && (!until || d <= until);
        });
        pr.commentDetails.forEach((comment) => {
          const reactions = comment.reactionGroups.reduce((acc, group) => {
            if (group.reactors.totalCount > 0) {
              acc[group.content] = group.reactors.totalCount;
            }
            return acc;
          }, {});
          delete comment.reactionGroups;
          if (Object.keys(reactions).length) {
            comment.reactions = reactions;
          }
        });
        pr.reviewDetails = reviewDetails.filter((review) => {
          const d = new Date(review.createdAt);
          return d >= since && (!until || d <= until);
        });
        pr.changedFiles = changedFiles;
        pr.timelineItems = timelineItems;
      })()
    );
  }
  await Promise.all(queue);
  return activity;
}
// Attach to the fetchUserActivity function
fetchUserActivity.enrichPullRequestData = enrichPullRequestData;

// Fetch PRs from a specific repo by author using the search API
async function fetchRepoPRs(owner, repo, login, since, token, until = null) {
  let dateRange = `updated:>=${since.toISOString().slice(0, 10)}`;
  if (until) {
    dateRange = `updated:${since.toISOString().slice(0, 10)}..${until.toISOString().slice(0, 10)}`;
  }
  const searchQuery = `repo:${owner}/${repo} author:${login} is:pr ${dateRange}`;
  let allPRs = [];
  let cursor = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const data = await fetchQuerySafe(repoSearchPRsGraphql, { searchQuery, cursor }, token, { data: null });
    if (!data || !data.data) break;
    const search = data.data.search;
    if (!search) break;
    allPRs = allPRs.concat(search.nodes.filter(n => n.title)); // filter out empty nodes
    hasNextPage = search.pageInfo.hasNextPage;
    cursor = search.pageInfo.endCursor;
  }
  return allPRs;
}

// Fetch issues from a specific repo by author using the search API
async function fetchRepoIssues(owner, repo, login, since, token, until = null) {
  let dateRange = `updated:>=${since.toISOString().slice(0, 10)}`;
  if (until) {
    dateRange = `updated:${since.toISOString().slice(0, 10)}..${until.toISOString().slice(0, 10)}`;
  }
  const searchQuery = `repo:${owner}/${repo} author:${login} is:issue ${dateRange}`;
  let allIssues = [];
  let cursor = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const data = await fetchQuerySafe(repoSearchIssuesGraphql, { searchQuery, cursor }, token, { data: null });
    if (!data || !data.data) break;
    const search = data.data.search;
    if (!search) break;
    allIssues = allIssues.concat(search.nodes.filter(n => n.title));
    hasNextPage = search.pageInfo.hasNextPage;
    cursor = search.pageInfo.endCursor;
  }
  return allIssues;
}

// Fetch activity from a single repo directly (PRs, issues, commits by author)
async function fetchDirectRepoActivity(owner, repo, login, since, token, until = null, authorId = null) {
  if (!authorId) {
    authorId = await fetchUniqueIdForUser(login, token);
  }
  const [pullRequests, issues, commits] = await Promise.all([
    fetchRepoPRs(owner, repo, login, since, token, until),
    fetchRepoIssues(owner, repo, login, since, token, until),
    fetchCommitContributionsForRepo(owner, repo, since, authorId, token, until)
  ]);

  return {
    pullRequests,
    issues,
    commitsByRepo: commits.length > 0 ? [{
      repository: { nameWithOwner: `${owner}/${repo}` },
      contributions: { totalCount: commits.length, nodes: commits, directCommits: commits.length }
    }] : []
  };
}

// Fetch activity from multiple additional repos in parallel
export async function fetchAdditionalReposActivity(repoList, login, since, token, until = null) {
  const authorId = await fetchUniqueIdForUser(login, token);
  const results = await Promise.all(
    repoList.map(repoStr => {
      const [owner, repo] = repoStr.split('/');
      return fetchDirectRepoActivity(owner, repo, login, since, token, until, authorId);
    })
  );

  const combined = { pullRequests: [], issues: [], commitsByRepo: [] };
  for (const result of results) {
    combined.pullRequests = combined.pullRequests.concat(result.pullRequests);
    combined.issues = combined.issues.concat(result.issues);
    combined.commitsByRepo = combined.commitsByRepo.concat(result.commitsByRepo);
  }
  return combined;
}

// Merge additional repo activity into main activity, deduplicating
export function mergeActivity(main, additional) {
  const existingPRKeys = new Set(
    main.pullRequests.map(pr => `${pr.repository.nameWithOwner}#${pr.number}`)
  );
  for (const pr of additional.pullRequests) {
    const key = `${pr.repository.nameWithOwner}#${pr.number}`;
    if (!existingPRKeys.has(key)) {
      main.pullRequests.push(pr);
      existingPRKeys.add(key);
    }
  }

  const existingIssueKeys = new Set(
    main.issues.map(i => `${i.repository.nameWithOwner}#${i.number}`)
  );
  for (const issue of additional.issues) {
    const key = `${issue.repository.nameWithOwner}#${issue.number}`;
    if (!existingIssueKeys.has(key)) {
      main.issues.push(issue);
      existingIssueKeys.add(key);
    }
  }

  const existingRepos = new Set(
    main.commitsByRepo.map(c => c.repository.nameWithOwner)
  );
  for (const entry of additional.commitsByRepo) {
    if (!existingRepos.has(entry.repository.nameWithOwner)) {
      main.commitsByRepo.push(entry);
    }
  }
}

function shorten(str, maxLength) {
  return str.length > maxLength ? str.slice(0, maxLength) + '…' : str;
}

// Format a date as ISO 8601 (YYYY-MM-DD)
function isoDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().slice(0, 10);
}

// Generate formatted activity report
export function generateActivityReport(activity, since, username, format = 'html', enrich = false, until = null, additionalRepos = []) {
  const shortenChars = format === 'console' ? 50 : Infinity;
  const { pullRequests, reviews, issues, commitsByRepo } = activity;

  let output = [];
  const print = (str) => output.push(str);

  const htmlTable = (headers, data) => {
    // Separate footer rows (Total/TOTAL) so Tablesort leaves them pinned
    const bodyRows = [];
    const footRows = [];
    data.forEach((row) => {
      const first = String(row[headers[0]] || '');
      if (first.includes('Total') || first === 'TOTAL') {
        footRows.push(row);
      } else {
        bodyRows.push(row);
      }
    });

    print('<table>');
    print('<thead><tr>');
    headers.forEach((header) => print(`<th>${header}</th>`));
    print('</tr></thead>');
    print('<tbody>');
    bodyRows.forEach((row) => {
      print('<tr>');
      headers.forEach((header) => print(`<td>${row[header] || ''}</td>`));
      print('</tr>');
    });
    print('</tbody>');
    if (footRows.length > 0) {
      print('<tfoot>');
      footRows.forEach((row) => {
        print('<tr>');
        headers.forEach((header) => print(`<td>${row[header] || ''}</td>`));
        print('</tr>');
      });
      print('</tfoot>');
    }
    print('</table>');
  };

  const plainTable = (headers, data) => {
    data.forEach((row) => {
      print(headers.map((header) => `${header}: ${row[header]}`).join(' | '));
    });
  };
  
  const table = format === 'html' ? htmlTable : plainTable;

  const heading =
    format === 'html' ? (str) => print(`<h3>${str}</h3>\n`) : (str) => print(`\n## ${str}\n`);

  // Generate header
  const dateRange = until
    ? `${isoDate(since)} to ${isoDate(until)}`
    : `since ${isoDate(since)}`;
  print(
    `${
      format === 'html' ? '<h2>' : '# '
    }Activity for @${username} ${dateRange}${
      format === 'html' ? '</h2>' : ''
    }`
  );

  heading('Repo Summary');

  // Build per-repo stats from all activity types
  // Repos queried via Additional Private Repos don't have review data — mark with asterisk.
  const repoStats = {};
  const additionalRepoSet = new Set(additionalRepos.map(r => r.toLowerCase()));

  const getRepo = (name) => {
    if (!repoStats[name]) {
      repoStats[name] = { commits: 0, prsAuthored: 0, issuesCreated: 0, issuesCommented: 0, prsReviewedNonBot: 0, prsReviewedBot: 0 };
    }
    return repoStats[name];
  };

  commitsByRepo.forEach(({ repository, contributions }) => {
    getRepo(repository.nameWithOwner).commits = contributions.totalCount;
  });
  pullRequests.forEach((pr) => {
    getRepo(pr.repository.nameWithOwner).prsAuthored++;
  });
  issues.forEach((issue) => {
    const stats = getRepo(issue.repository.nameWithOwner);
    stats.issuesCreated++;
    if (issue.comments.totalCount > 0) stats.issuesCommented++;
  });
  reviews
    .filter((review) => review.pullRequest.author?.login && review.pullRequest.author.login !== username)
    .forEach((review) => {
      const stats = getRepo(review.repository.nameWithOwner);
      const prAuthor = review.pullRequest.author.login.toLowerCase();
      if (prAuthor.endsWith('[bot]') || prAuthor === 'dependabot' || prAuthor === 'renovate' || prAuthor === 'greenkeeper') {
        stats.prsReviewedBot++;
      } else {
        stats.prsReviewedNonBot++;
      }
    });

  const asterisk = format === 'html' ? '<span title="Review data not available for directly queried repos">*</span>' : '*';
  let hasAsterisk = false;

  const repoSummaryData = Object.entries(repoStats)
    .sort((a, b) => {
      const totalA = a[1].commits + a[1].prsAuthored + a[1].issuesCreated + a[1].prsReviewedNonBot + a[1].prsReviewedBot;
      const totalB = b[1].commits + b[1].prsAuthored + b[1].issuesCreated + b[1].prsReviewedNonBot + b[1].prsReviewedBot;
      return totalB - totalA;
    })
    .map(([name, stats]) => {
      const noReviewData = additionalRepoSet.has(name.toLowerCase());
      if (noReviewData) hasAsterisk = true;
      return {
        Repository: name,
        Commits: stats.commits,
        'PRs Authored': stats.prsAuthored,
        'PRs Reviewed (non-bot)': noReviewData ? asterisk : stats.prsReviewedNonBot,
        'PRs Reviewed (bot)': noReviewData ? asterisk : stats.prsReviewedBot,
        'Issues Created': stats.issuesCreated,
        'Issues Commented': stats.issuesCommented
      };
    });

  // Add totals row
  const totals = { commits: 0, prsAuthored: 0, prsReviewedNonBot: 0, prsReviewedBot: 0, issuesCreated: 0, issuesCommented: 0 };
  for (const stats of Object.values(repoStats)) {
    totals.commits += stats.commits;
    totals.prsAuthored += stats.prsAuthored;
    totals.prsReviewedNonBot += stats.prsReviewedNonBot;
    totals.prsReviewedBot += stats.prsReviewedBot;
    totals.issuesCreated += stats.issuesCreated;
    totals.issuesCommented += stats.issuesCommented;
  }
  const totalLabel = format === 'html' ? '<strong>Total</strong>' : 'TOTAL';
  repoSummaryData.push({
    Repository: totalLabel,
    Commits: totals.commits,
    'PRs Authored': totals.prsAuthored,
    'PRs Reviewed (non-bot)': totals.prsReviewedNonBot,
    'PRs Reviewed (bot)': totals.prsReviewedBot,
    'Issues Created': totals.issuesCreated,
    'Issues Commented': totals.issuesCommented
  });

  const headers = ['Repository', 'Commits', 'PRs Authored', 'PRs Reviewed (non-bot)', 'PRs Reviewed (bot)', 'Issues Created', 'Issues Commented'];
  table(headers, repoSummaryData);

  if (hasAsterisk) {
    const note = format === 'html'
      ? '<p class="text-muted mt-1"><small>* Review data is not available for repos queried directly via Additional Private Repos.</small></p>'
      : '* Review data is not available for repos queried directly via Additional Private Repos.';
    print(note);
  }

  heading('Pull Requests');

  const prSummary = pullRequests.map((pr) => ({
    State: pr.state,
    Title: `${
      format === 'html'
        ? `<a href="https://github.com/${pr.repository.nameWithOwner}/pull/${pr.number}">${pr.repository.nameWithOwner}/#${pr.number}</a>: `
        : ''
    }${shorten(pr.title, shortenChars)}`,
    Created: isoDate(pr.createdAt),
    Merged: pr.mergedAt ? isoDate(pr.mergedAt) : '-',
    'Comments/Reviews': `${pr.comments.totalCount}/${pr.reviews.totalCount}`,
    Changes: `+${pr.additions}/-${pr.deletions}`,
    PR: `https://github.com/${pr.repository.nameWithOwner}/pull/${pr.number}`
  }));

  if (format === 'plain' && enrich) {
    prSummary.forEach((row, idx) => {
      print(
        `PR: ${row.Title} (${row.Created}) | State: ${row.State} | Merged: ${row.Merged} | Comments/Reviews: ${row['Comments/Reviews']} | Changes: ${row.Changes}`
      );
      print('Changed files:');
      pullRequests[idx].changedFiles?.forEach((file) => {
        print(`  - ${file.path} (${file.additions} additions, ${file.deletions} deletions)`);
      });
      print('Timeline:');
      pullRequests[idx].timelineItems?.forEach((item) => {
        if (!item || !item.__typename) return; // Skip null or invalid timeline items
        switch (item.__typename) {
          case 'ReadyForReviewEvent':
            print(
              `  - Ready for review by ${item.actor.login} (${isoDate(item.createdAt)})`
            );
            break;
          case 'ReviewRequestedEvent':
            print(
              `  - Review requested from ${item.requestedReviewer?.login || 'a team'} by ${
                item.actor.login
              } (${isoDate(item.createdAt)})`
            );
            break;
          case 'MergedEvent':
            print(
              `  - Merged by ${item.actor.login} (${isoDate(item.createdAt)})`
            );
            break;
          default:
            break;
        }
      });
      if (new Date(pullRequests[idx].createdAt) >= since) {
        print('Body:');
        if (pullRequests[idx].body) {
          print(pullRequests[idx].body.replace(/^/gm, '  '));
        }
      }
      print('Comments:' + (pullRequests[idx].commentDetails?.length ? '' : ' None'));
      pullRequests[idx].commentDetails?.forEach((comment) => {
        print(`  - ${comment.author.login} (${isoDate(comment.createdAt)})`);
        print(comment.bodyText.replace(/^/gm, '    '));
      });
      print('Reviews:' + (pullRequests[idx].reviewDetails?.length ? '' : ' None'));
      pullRequests[idx].reviewDetails?.forEach((review) => {
        print(`  - ${review.author.login} (${isoDate(review.createdAt)})`);
        print(`    State: ${review.state}`);
        review.comments.nodes.forEach((comment) => {
          print(`    - ${comment.bodyText}`);
        });
      });
      print('');
    });
  } else {
    table(
      ['Created', 'State', 'Title', 'Merged', 'Comments/Reviews', 'Changes'].concat(
        format === 'html' ? [] : ['PR']
      ),
      prSummary
    );
  }

  heading('Issues');
  table(
    ['Created', 'Title', 'Closed', 'Comments'].concat(format === 'html' ? [] : ['Issue']),
    issues.map((issue) => ({
      Title: `${
        format === 'html'
          ? `<a href="https://github.com/${issue.repository.nameWithOwner}/issues/${issue.number}">${issue.repository.nameWithOwner}/#${issue.number}</a>: `
          : ''
      }${shorten(issue.title, shortenChars)}`,
      Created: isoDate(issue.createdAt),
      Closed: issue.closedAt ? isoDate(issue.closedAt) : '-',
      Comments: issue.comments.totalCount,
      Issue: `https://github.com/${issue.repository.nameWithOwner}/issues/${issue.number}`
    }))
  );

  heading('Reviews');
  table(
    ['Date', 'State', 'Title', 'Author', 'Comments'].concat(format === 'html' ? [] : ['PR']),
    reviews
      .filter((review) => review.pullRequest.author?.login && review.pullRequest.author.login !== username)
      .map((review) => ({
        Date: isoDate(review.createdAt),
        State: review.state,
        Title: `${
          format === 'html'
            ? `<a href="https://github.com/${review.repository.nameWithOwner}/pull/${review.pullRequest.number}">${review.repository.nameWithOwner}#${review.pullRequest.number}</a>: `
            : ''
        }${shorten(review.pullRequest.title, shortenChars)}`,
        Author: review.pullRequest.author.login,
        Comments: review.comments.totalCount,
        PR: `https://github.com/${review.repository.nameWithOwner}/pull/${review.pullRequest.number}`
      }))
  );

  // In enriched plain text mode, show commit details per repo
  if (format === 'plain' && enrich) {
    heading('Commit Details');
    commitsByRepo.forEach(({ repository, contributions, repoInfo }) => {
      if (!contributions.nodes?.length) return;
      print(
        `Repository: ${repository.nameWithOwner}${repoInfo?.description ? ` (${repoInfo.description})` : ''}`
      );
      contributions.nodes.forEach((commit) => {
        print(
          `  - ${commit.messageHeadline} (${isoDate(commit.committedDate)})`
        );
        if (commit.messageBody) {
          print(commit.messageBody.replace(/^/gm, '    '));
        }
      });
      print('');
    });
  }

  return output.join('\n');
}

// Helper function for JSON output
export function generateJsonOutput(activity, login, since) {
  const { pullRequests, reviews, issues, commitsByRepo } = activity;

  return {
    username: login,
    period: {
      start: since.toISOString(),
      end: new Date().toISOString()
    },
    stats: {
      totalPRs: pullRequests.length,
      totalReviews: reviews.length,
      totalIssues: issues.length,
      totalCommitRepos: commitsByRepo.length,
      totalCommits: commitsByRepo.reduce(
        (sum, repo) => sum + (repo.contributions.directCommits || 0),
        0
      )
    },
    // Include enriched data when available
    pullRequests: pullRequests.map((pr) => ({
      title: pr.title,
      url: `https://github.com/${pr.repository.nameWithOwner}/pull/${pr.number}`,
      repo: pr.repository.nameWithOwner,
      number: pr.number,
      state: pr.state,
      created: pr.createdAt,
      merged: pr.mergedAt,
      additions: pr.additions,
      deletions: pr.deletions,
      commentCount: pr.comments.totalCount,
      reviewCount: pr.reviews.totalCount,
      body: pr.body,
      // Include enriched data if available
      commentDetails: pr.commentDetails,
      reviewDetails: pr.reviewDetails,
      changedFiles: pr.changedFiles,
      timelineItems: pr.timelineItems
    })),
    issues,
    reviews,
    commitsByRepo
  };
}