// Direct fetch approach for Anthropic API
// Import node-fetch explicitly not needed in newer Node versions that have native fetch

const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_HEADERS = {
  'anthropic-version': '2023-06-01',
  'Content-Type': 'application/json'
};

/**
 * Count the actual tokens for a messages request using the Anthropic token counting API.
 * Returns the input token count.
 */
async function countTokens(requestBody, apiKey) {
  // The count tokens endpoint only accepts model, messages, and system — not max_tokens
  const { max_tokens, ...countBody } = requestBody;
  const response = await fetch(`${ANTHROPIC_API_BASE}/messages/count_tokens`, {
    method: 'POST',
    headers: { ...ANTHROPIC_HEADERS, 'x-api-key': apiKey },
    body: JSON.stringify(countBody)
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Token counting error: ${response.status} ${errorData.error?.message || JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  return data.input_tokens;
}

/**
 * Fetch the max input token limit for a given model from the Anthropic models API.
 * Falls back to 200000 if the lookup fails.
 */
async function getModelMaxInputTokens(model, apiKey) {
  try {
    const response = await fetch(`${ANTHROPIC_API_BASE}/models/${model}`, {
      method: 'GET',
      headers: { ...ANTHROPIC_HEADERS, 'x-api-key': apiKey }
    });

    if (!response.ok) {
      console.log(`Could not fetch model info for ${model}, using default max input tokens`);
      return 200000;
    }

    const data = await response.json();
    return data.max_input_tokens || 200000;
  } catch (error) {
    console.log(`Error fetching model info: ${error.message}, using default max input tokens`);
    return 200000;
  }
}

/**
 * Compression levels — each strips more verbose content while preserving all activity items.
 *
 * Level 0: No compression (original text)
 * Level 1: Drop commit message bodies (keep headlines); PR bodies are more useful
 * Level 2: Truncate long PR bodies, comments, and review text to 500 chars
 * Level 3: Remove PR bodies and commit message bodies entirely; truncate comments to 200 chars
 * Level 4: Remove comments and review text; keep only structural data (titles, stats, dates)
 * Level 5: Remove changed file lists and timelines; bare-bones summary lines only
 */
const compressionLevels = [
  { name: 'drop commit bodies', dropped: ['Commit message bodies'], fn: compressLevel1 },
  { name: 'truncate long content', dropped: ['Commit message bodies', 'Long PR bodies, comments, and reviews (truncated to 500 chars)'], fn: compressLevel2 },
  { name: 'remove PR bodies', dropped: ['Commit message bodies', 'PR body text', 'Long comments and reviews (truncated to 200 chars)'], fn: compressLevel3 },
  { name: 'remove comments/reviews', dropped: ['Commit message bodies', 'PR body text', 'Comment and review text'], fn: compressLevel4 },
  { name: 'structural only', dropped: ['Commit message bodies', 'PR body text', 'Comment and review text', 'Changed file lists', 'Timeline events'], fn: compressLevel5 }
];

/**
 * Build the messages request body (without sending it).
 */
function buildRequestBody(activityText, systemPrompt, model, maxTokens, isMultiUser, usernames, compressionNote) {
  const userMessage = isMultiUser
    ? `Here is the GitHub activity report for ${usernames.length} users to summarize. Each user's data is in a separate section:\n\n${activityText}${compressionNote}`
    : `Here is the GitHub activity report to summarize:\n\n${activityText}${compressionNote}`;

  return {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userMessage }],
    system: systemPrompt
  };
}

// Level 1: Drop commit message bodies (indented text under commit headlines), keep headlines
function compressLevel1(lines) {
  const result = [];
  let inCommitSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect "Commit Details" or "Commits by Repository" section
    if (line.match(/^## Commit Details/) || line.match(/^## Commits by Repository/) || line.match(/^Repository:/)) {
      inCommitSection = true;
      result.push(line);
      continue;
    }

    // Detect leaving commit section (next top-level heading)
    if (inCommitSection && line.match(/^## /) && !line.match(/Commit Details/) && !line.match(/Commits by Repository/)) {
      inCommitSection = false;
    }

    if (inCommitSection) {
      // Keep commit headline lines ("  - message (date)") but drop body lines (4+ space indent under them)
      if (line.startsWith('    ') && i > 0 && (lines[i - 1].startsWith('  - ') || lines[i - 1].startsWith('    '))) {
        continue;
      }
    }

    result.push(line);
  }
  return result.join('\n');
}

// Level 2: Truncate long content blocks to 500 chars
function compressLevel2(lines) {
  const result = [];
  let inBody = false;
  let bodyLines = [];

  for (const line of lines) {
    if (line === 'Body:' || line === 'Comments:' || line === 'Reviews:') {
      if (inBody && bodyLines.length > 0) {
        result.push(truncateBlock(bodyLines, 500));
      }
      inBody = true;
      bodyLines = [];
      result.push(line);
    } else if (inBody && (line.startsWith('  ') || line === '')) {
      bodyLines.push(line);
    } else {
      if (inBody && bodyLines.length > 0) {
        result.push(truncateBlock(bodyLines, 500));
      }
      inBody = false;
      bodyLines = [];
      // Truncate long commit message bodies (indented under commit lines)
      if (line.startsWith('    ') && line.length > 500) {
        result.push(line.slice(0, 500) + '...');
      } else {
        result.push(line);
      }
    }
  }
  if (inBody && bodyLines.length > 0) {
    result.push(truncateBlock(bodyLines, 500));
  }
  return result.join('\n');
}

// Level 3: Remove PR bodies and commit message bodies; truncate comments to 200 chars
function compressLevel3(lines) {
  const result = [];
  let skip = false;
  let section = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line === 'Body:') {
      skip = true;
      section = 'body';
      result.push('Body: [omitted for brevity]');
      continue;
    }
    if (line.startsWith('Comments:')) {
      skip = false;
      section = 'comments';
      result.push(line);
      continue;
    }
    if (line.startsWith('Reviews:')) {
      skip = false;
      section = 'reviews';
      result.push(line);
      continue;
    }
    if (line.startsWith('Changed files:') || line.startsWith('Timeline:') || line.startsWith('PR:')) {
      skip = false;
      section = null;
      result.push(line);
      continue;
    }

    if (skip && section === 'body') {
      if (!line.startsWith('  ') && line !== '') {
        skip = false;
        section = null;
        result.push(line);
      }
      continue;
    }

    // Truncate comment/review text
    if ((section === 'comments' || section === 'reviews') && line.startsWith('    ') && line.length > 200) {
      result.push(line.slice(0, 200) + '...');
      continue;
    }

    // Remove commit message bodies (lines indented with 4+ spaces after a commit headline)
    if (line.startsWith('    ') && i > 0 && lines[i - 1].startsWith('  - ') && section === null) {
      continue;
    }

    result.push(line);
  }
  return result.join('\n');
}

// Level 4: Remove all comment text and review text, keeping only counts
function compressLevel4(lines) {
  const result = [];
  let skipUntilNext = false;
  let section = null;

  for (const line of lines) {
    if (line === 'Body:') {
      skipUntilNext = true;
      section = 'body';
      continue;
    }
    if (line.startsWith('Comments:')) {
      skipUntilNext = true;
      section = 'comments';
      result.push(line.includes('None') ? line : line.replace(/:.*/, ': [details omitted]'));
      continue;
    }
    if (line.startsWith('Reviews:')) {
      skipUntilNext = true;
      section = 'reviews';
      result.push(line.includes('None') ? line : line.replace(/:.*/, ': [details omitted]'));
      continue;
    }
    if (line.startsWith('Changed files:') || line.startsWith('Timeline:') || line.startsWith('PR:') || line.match(/^## /)) {
      skipUntilNext = false;
      section = null;
      result.push(line);
      continue;
    }

    if (skipUntilNext && (line.startsWith('  ') || line === '')) {
      continue;
    }
    if (skipUntilNext) {
      skipUntilNext = false;
      section = null;
    }

    // Still remove commit message bodies
    if (line.startsWith('    ') && !line.startsWith('  - ')) {
      continue;
    }

    result.push(line);
  }
  return result.join('\n');
}

// Level 5: Remove changed files, timelines, comments, reviews, bodies — structural data only
function compressLevel5(lines) {
  const result = [];
  let skipBlock = false;

  for (const line of lines) {
    if (line === 'Body:' || line.startsWith('Comments:') || line.startsWith('Reviews:') ||
        line === 'Changed files:' || line === 'Timeline:') {
      skipBlock = true;
      continue;
    }

    if (skipBlock) {
      if (line.startsWith('  ') || line === '') {
        continue;
      }
      skipBlock = false;
    }

    // Remove commit message bodies
    if (line.startsWith('    ')) {
      continue;
    }

    result.push(line);
  }
  return result.join('\n');
}

function truncateBlock(blockLines, maxChars) {
  const joined = blockLines.join('\n');
  if (joined.length <= maxChars) return joined;
  return joined.slice(0, maxChars) + '\n  [truncated]';
}

// Generate a summary of GitHub activity using Claude
export async function generateSummary(activityText, apiKey, isMultiUser = false, usernames = [], model = 'claude-3-5-sonnet-latest') {
  try {
    console.log('Using direct API call to Anthropic');

    if (!apiKey) {
      throw new Error('Anthropic API key is missing');
    }

    // Fetch the model's actual max input token limit
    const maxInputTokens = await getModelMaxInputTokens(model, apiKey);
    console.log(`Model ${model} max input tokens: ${maxInputTokens}`);

    // Choose appropriate system prompt based on single or multi-user
    let systemPrompt;

    if (isMultiUser) {
      systemPrompt = `You are assisting in crafting a collaborative activity report for
a group of software engineers who are members of the GitHub community. The team is
interested in understanding their collective GitHub activity over a specific time period.
You will be provided with an activity report containing data for ${usernames.length} GitHub users.

The report is organized into sections, one for each user, marked with "==== USER: @username ====" headers.

Your task is to review the collective report and provide a summary that:
1. Highlights notable individual contributions
2. Identifies patterns or areas of collaboration between team members
3. Summarizes the overall team productivity and focus areas
4. Notes any significant projects that multiple team members worked on

Your summary should be brief and to the point, focusing on the most important
insights from the report, both at individual and group levels.

IMPORTANT: You must output properly formatted HTML that can be directly embedded in a web page.
Use the following format for your response:

<div class="summary">
  <h3>Activity Summary</h3>
  <p>Brief overall assessment of the team's activity.</p>

  <h4>Key Contributions</h4>
  <ul>
    <li>Notable contribution 1</li>
    <li>Notable contribution 2</li>
    <!-- More list items as needed -->
  </ul>

  <h4>Collaboration Highlights</h4>
  <ul>
    <li>Collaboration point 1</li>
    <li>Collaboration point 2</li>
    <!-- More list items as needed -->
  </ul>

  <h4>Project Focus Areas</h4>
  <ul>
    <li>Project area 1</li>
    <li>Project area 2</li>
    <!-- More list items as needed -->
  </ul>
</div>

Make sure all HTML tags are properly closed and the content is well-structured.`;
    } else {
      systemPrompt = `You are assisting in crafting a weekly activity report for
a software engineer who is a member of the GitHub community. The engineer is
interested in understanding their GitHub activity over a specific time period.
You will be provided with an activity report generated from the GitHub API.
Your task is to review the report and provide a summary of notable activity
and any activity that requires further investigation.

Your summary should be brief and to the point, focusing on the most important
insights from the report.

IMPORTANT: You must output properly formatted HTML that can be directly embedded in a web page.
Use the following format for your response:

<div class="summary">
  <h3>Activity Summary</h3>
  <p>Brief overall assessment of activity.</p>

  <h4>Key Contributions</h4>
  <ul>
    <li>Notable contribution 1</li>
    <li>Notable contribution 2</li>
    <!-- More list items as needed -->
  </ul>

  <h4>Pull Requests and Issues</h4>
  <ul>
    <li>PR/Issue activity 1</li>
    <li>PR/Issue activity 2</li>
    <!-- More list items as needed -->
  </ul>

  <h4>Active Projects</h4>
  <ul>
    <li>Project 1</li>
    <li>Project 2</li>
    <!-- More list items as needed -->
  </ul>
</div>

Make sure all HTML tags are properly closed and the content is well-structured.`;
    }

    const maxTokens = isMultiUser ? 4096 : 4096;

    // Build the initial request and count tokens
    let currentText = activityText;
    let compressionLevel = 0;
    let compressionNote = '';
    let requestBody = buildRequestBody(currentText, systemPrompt, model, maxTokens, isMultiUser, usernames, compressionNote);
    let inputTokens = await countTokens(requestBody, apiKey);

    console.log(`Initial token count: ${inputTokens} (limit: ${maxInputTokens})`);

    // Progressively compress until it fits
    const lines = activityText.split('\n');
    while (inputTokens > maxInputTokens && compressionLevel < compressionLevels.length) {
      const level = compressionLevels[compressionLevel];
      currentText = level.fn(lines);
      compressionLevel++;
      compressionNote = '\n\n(Note: Some detail was omitted from this report to fit within the context window. Summarize based on what is provided.)';
      requestBody = buildRequestBody(currentText, systemPrompt, model, maxTokens, isMultiUser, usernames, compressionNote);
      inputTokens = await countTokens(requestBody, apiKey);
      console.log(`Compression level ${compressionLevel} (${level.name}): ${inputTokens} tokens`);
    }

    // Final fallback: hard truncation by binary-searching a character limit
    if (inputTokens > maxInputTokens) {
      // Estimate how much to cut based on the ratio
      const ratio = maxInputTokens / inputTokens;
      currentText = currentText.slice(0, Math.floor(currentText.length * ratio * 0.95));
      compressionNote = '\n\n(Note: This report was truncated to fit within the context window. Summarize based on what is provided.)';
      requestBody = buildRequestBody(currentText, systemPrompt, model, maxTokens, isMultiUser, usernames, compressionNote);
      console.log(`Hard truncation applied, estimated to fit within ${maxInputTokens} tokens`);
    }

    console.log('Using Claude model:', model);

    // Make direct API call to Anthropic
    const response = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
      method: 'POST',
      headers: { ...ANTHROPIC_HEADERS, 'x-api-key': apiKey },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Anthropic API error: ${response.status} ${errorData.error?.message || JSON.stringify(errorData)}`);
    }

    const responseData = await response.json();
    console.log('Received response from Anthropic API');

    // Build compression info for the caller
    const compressionInfo = compressionLevel > 0
      ? {
          level: compressionLevel,
          dropped: compressionLevel <= compressionLevels.length
            ? compressionLevels[compressionLevel - 1].dropped
            : ['Report was hard-truncated to fit'],
        }
      : null;

    // Extract and return the HTML summary with compression metadata
    return {
      html: responseData.content[0].text,
      compressionInfo
    };
  } catch (error) {
    console.error('Error generating summary with Anthropic:', error);
    throw new Error(`Failed to generate summary: ${error.message}`);
  }
}
