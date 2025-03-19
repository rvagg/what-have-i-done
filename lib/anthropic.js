// Direct fetch approach for Anthropic API
// Import node-fetch explicitly not needed in newer Node versions that have native fetch

// Generate a summary of GitHub activity using Claude
export async function generateSummary(activityText, apiKey, isMultiUser = false, usernames = [], model = 'claude-3-5-sonnet-latest') {
  try {
    console.log('Using direct API call to Anthropic');
    
    if (!apiKey) {
      throw new Error('Anthropic API key is missing');
    }
    
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

    console.log('Sending direct request to Anthropic API...');
    
    // Adjust the user message based on single or multi-user
    const userMessage = isMultiUser
      ? `Here is the GitHub activity report for ${usernames.length} users to summarize. Each user's data is in a separate section:\n\n${activityText}`
      : `Here is the GitHub activity report to summarize:\n\n${activityText}`;
    
    // Create request body for message API
    const requestBody = {
      model: model, // Use the provided model or default
      max_tokens: isMultiUser ? 1500 : 1000, // Allow more tokens for multi-user summaries
      messages: [
        {
          role: "user", 
          content: userMessage
        }
      ],
      system: systemPrompt
    };
    
    console.log('Using Claude model:', model);
    
    // Make direct API call to Anthropic
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Anthropic API error: ${response.status} ${errorData.error?.message || JSON.stringify(errorData)}`);
    }
    
    const responseData = await response.json();
    console.log('Received response from Anthropic API');
    
    // Extract and return the HTML summary
    return responseData.content[0].text;
  } catch (error) {
    console.error('Error generating summary with Anthropic:', error);
    throw new Error(`Failed to generate summary: ${error.message}`);
  }
}