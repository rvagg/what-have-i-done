// GraphQL queries
const userActivityGraphql = `
  query($cursor: String, $login: String!, $since: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $since) {
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
  query($owner: String!, $repo: String!, $commitCursor: String, $since: GitTimestamp!) {
    repository(owner: $owner, name: $repo) {
      defaultBranchRef {
        target {
          ... on Commit {
            history(since: $since, first: 100, after: $commitCursor, author: {id: "{{authorId}}"}) {
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

const userIdGraphql = `
  query($login: String!) {
    user(login: $login) {
      id
    }
  }
`;

// Fetch data from GitHub API
async function fetchQuery(query, variables, token) {
  if (!token) {
    throw new Error('GitHub token is required');
  }

  console.log('Making GitHub API request with token:', token.substring(0, 5) + '...');
  
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

  if (response.status !== 200) {
    throw new Error(`Failed to fetch user activity data: ${response.statusText}`);
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error(`Failed to fetch user activity data: ${data.errors[0].message}`);
  }
  return data;
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
export async function fetchUserActivity(login, since, token) {
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

  while (hasNextPage) {
    const data = await fetchQuery(userActivityGraphql, { cursor, login, since: from.toISOString() }, token);
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

  // Filter contributions to include only those updated since the specified date
  activity.pullRequests = activity.pullRequests.filter((pr) => new Date(pr.updatedAt) >= since);
  activity.reviews = activity.reviews.filter((review) => new Date(review.updatedAt) >= since);
  activity.issues = activity.issues.filter((issue) => new Date(issue.updatedAt) >= since);

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
async function fetchCommitContributionsForRepo(owner, repo, since, authorId, token) {
  const query = contributionsByRepoGraphql.replace('{{authorId}}', authorId);
  let allCommits = [];
  let commitCursor = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const variables = { owner, repo, commitCursor, since: since.toISOString() };
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

async function enrichCommitContributions(activity, since, author, token) {
  const authorId = await fetchUniqueIdForUser(author, token);
  const queue = [];
  for (const repoContribution of activity.commitsByRepo) {
    const repoName = repoContribution.repository.nameWithOwner;
    const [owner, repo] = repoName.split('/');
    queue.push(
      (async () => {
        const extraCommits = await fetchCommitContributionsForRepo(owner, repo, since, authorId, token);
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

async function enrichPullRequestData(activity, since, login, token) {
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

        pr.commentDetails = comments.filter((comment) => new Date(comment.createdAt) >= since);
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
        pr.reviewDetails = reviewDetails.filter((review) => new Date(review.createdAt) >= since);
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

function shorten(str, maxLength) {
  return str.length > maxLength ? str.slice(0, maxLength) + '…' : str;
}

// Generate formatted activity report
export function generateActivityReport(activity, since, username, format = 'html', enrich = false) {
  const shortenChars = format === 'console' ? 50 : Infinity;
  const { pullRequests, reviews, issues, commitsByRepo } = activity;

  let output = [];
  const print = (str) => output.push(str);

  const htmlTable = (headers, data) => {
    print('<table>');
    print('<thead><tr>');
    headers.forEach((header) => print(`<th>${header}</th>`));
    print('</tr></thead>');
    print('<tbody>');
    data.forEach((row) => {
      print('<tr>');
      headers.forEach((header) => print(`<td>${row[header] || ''}</td>`));
      print('</tr>');
    });
    print('</tbody>');
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
  print(
    `${
      format === 'html' ? '<h2>' : '# '
    }Activity for @${username} since ${since.toLocaleDateString()}${
      format === 'html' ? '</h2>' : ''
    }`
  );

  heading('Pull Requests');

  const prSummary = pullRequests.map((pr) => ({
    State: pr.state,
    Title: `${
      format === 'html'
        ? `<a href="https://github.com/${pr.repository.nameWithOwner}/pull/${pr.number}">${pr.repository.nameWithOwner}/#${pr.number}</a>: `
        : ''
    }${shorten(pr.title, shortenChars)}`,
    Created: new Date(pr.createdAt).toLocaleDateString(),
    Merged: pr.mergedAt ? new Date(pr.mergedAt).toLocaleDateString() : '-',
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
        switch (item.__typename) {
          case 'ReadyForReviewEvent':
            print(
              `  - Ready for review by ${item.actor.login} (${new Date(
                item.createdAt
              ).toLocaleDateString()})`
            );
            break;
          case 'ReviewRequestedEvent':
            print(
              `  - Review requested from ${item.requestedReviewer?.login || 'a team'} by ${
                item.actor.login
              } (${new Date(item.createdAt).toLocaleDateString()})`
            );
            break;
          case 'MergedEvent':
            print(
              `  - Merged by ${item.actor.login} (${new Date(item.createdAt).toLocaleDateString()})`
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
        print(`  - ${comment.author.login} (${new Date(comment.createdAt).toLocaleDateString()})`);
        print(comment.bodyText.replace(/^/gm, '    '));
      });
      print('Reviews:' + (pullRequests[idx].reviewDetails?.length ? '' : ' None'));
      pullRequests[idx].reviewDetails?.forEach((review) => {
        print(`  - ${review.author.login} (${new Date(review.createdAt).toLocaleDateString()})`);
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
      Created: new Date(issue.createdAt).toLocaleDateString(),
      Closed: issue.closedAt ? new Date(issue.closedAt).toLocaleDateString() : '-',
      Comments: issue.comments.totalCount,
      Issue: `https://github.com/${issue.repository.nameWithOwner}/issues/${issue.number}`
    }))
  );

  heading('Reviews');
  table(
    ['Date', 'State', 'Title', 'Author', 'Comments'].concat(format === 'html' ? [] : ['PR']),
    reviews
      .filter((review) => review.pullRequest.author.login !== username)
      .map((review) => ({
        Date: new Date(review.createdAt).toLocaleDateString(),
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

  heading('Commits by Repository');
  if (format === 'plain' && enrich) {
    commitsByRepo.forEach(({ repository, contributions, repoInfo }) => {
      print(
        `Repository: ${repository.nameWithOwner} (${repoInfo?.description || ''}${
          repoInfo?.repositoryTopics?.nodes.length
            ? ' [' + repoInfo.repositoryTopics.nodes.map((t) => t.topic.name).join(', ') + ']'
            : ''
        }), Contributions: ${contributions.totalCount}, Commits landed: ${
          contributions.directCommits
        }`
      );
      contributions.nodes?.forEach((commit) => {
        print(
          `  - ${commit.messageHeadline} (${new Date(commit.committedDate).toLocaleDateString()})`
        );
        if (commit.messageBody) {
          print(commit.messageBody.replace(/^/gm, '    '));
        }
      });
      if (contributions.nodes?.length) {
        print('');
      }
    });
  } else {
    table(
      ['Repository', 'Commits'],
      commitsByRepo.map(({ repository, contributions }) => ({
        Repository: repository.nameWithOwner,
        Commits: contributions.totalCount
      }))
    );
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