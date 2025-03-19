# What have I done?

A web application to track and summarise your GitHub activity with AI-powered insights. Track your pull requests, issues, reviews, and commits across all repositories with a clean, user-friendly interface.

## Features

- **Comprehensive GitHub Activity Reports**: Track PRs, issues, reviews, and commits
- **Enriched Data**: View PR comments, file changes, review details, and commit messages
- **AI-Powered Summaries**: Generate concise summaries of activity using Anthropic Claude
- **Flexible Configuration**: Store credentials locally or in your home directory
- **Modern Web Interface**: Clean, responsive design for desktop and mobile

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/rvagg/what-have-i-done.git
   cd what-have-i-done
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Start the application:
   ```
   npm start
   ```

4. Open your browser and navigate to `http://localhost:3000` (default)

   To listen on all network interfaces, set the HOST environment variable:
   ```
   HOST=0.0.0.0 npm start
   ```
   This makes the server accessible from other devices on your network.

   Similarly, to change the port, set the PORT environment variable:
   ```
   PORT=8080 npm start
   ```
   This will start the server on port 8080 instead of the default 3000.

## Configuration

The application requires a GitHub personal access token to function. An Anthropic API key is optional, but required for generating AI summaries.

### GitHub Token

1. Create a personal access token at https://github.com/settings/tokens
2. No special permissions are required, a classic token with default scopes is sufficient
3. Enter the token in the application's Settings page

### Anthropic API Key (Optional)

1. Create an Anthropic API key at https://console.anthropic.com/account/keys
2. Enter the key in the application's Settings page

## Usage

1. Configure your GitHub token and optional Anthropic API key in Settings
2. Navigate to "Generate Report"
3. Enter a GitHub username and start date
4. Enable "Include enriched data" for more detailed information (takes longer to fetch)
5. Click "Generate Report" to view the activity

## Configuration Storage

Your configuration is stored in your home directory at:

`~/.what-have-i-done/config.json`

## License

Apache 2.0, ([LICENSE](LICENSE) / http://www.apache.org/licenses/LICENSE-2.0)
