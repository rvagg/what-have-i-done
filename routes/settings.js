import express from 'express';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Helper function to create a friendly display name for Claude models
function getModelDisplayName(modelId) {
  // Extract key components from the model ID
  let displayName = modelId;
  
  // Handle special cases first
  if (modelId.includes('latest')) {
    if (modelId.includes('claude-3-5-sonnet')) {
      return 'Claude 3.5 Sonnet (Latest)';
    }
    if (modelId.includes('claude-3-5-haiku')) {
      return 'Claude 3.5 Haiku (Latest)';
    }
    if (modelId.includes('claude-3-5-opus')) {
      return 'Claude 3.5 Opus (Latest)';
    }
    return modelId.replace('latest', 'Latest');
  }
  
  // For dated versions
  if (modelId.match(/\d{8}/)) {
    const dateMatch = modelId.match(/(\d{4})(\d{2})(\d{2})/);
    if (dateMatch) {
      const year = dateMatch[1];
      const month = dateMatch[2];
      const day = dateMatch[3];
      const dateStr = `${year}-${month}-${day}`;
      
      // Remove the date from the ID for the base name
      let baseName = modelId.replace(/\d{8}/, '').replace(/-$/, '');
      
      // Capitalize each word and cleanup formatting
      baseName = baseName.split('-').map(part => {
        if (part === 'claude') return 'Claude';
        if (part === '3') return '3';
        if (part === '3.5' || part === '35') return '3.5';
        return part.charAt(0).toUpperCase() + part.slice(1);
      }).join(' ');
      
      return `${baseName} (${dateStr})`;
    }
  }
  
  // For any other format
  return modelId
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// Function to get available Claude models from the Anthropic API
async function getAnthropicModels(apiKey) {
  try {
    if (!apiKey) {
      console.log('No Anthropic API key available to fetch models');
      return null;
    }

    console.log('Fetching available Claude models from Anthropic API');
    const response = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    });

    if (!response.ok) {
      console.error(`Error fetching models: ${response.status}`);
      return null;
    }

    const { data } = await response.json();
    console.log(`Found ${data.length} Claude models`);
    return data;
  } catch (error) {
    console.error('Error fetching Anthropic models:', error);
    return null;
  }
}

// Display settings form
router.get('/', async (req, res) => {
  const config = req.appConfig || {};
  
  // Try to fetch available models if API key is available
  let availableModels = null;
  if (config.anthropicKey) {
    availableModels = await getAnthropicModels(config.anthropicKey);
  }
  
  res.render('settings', {
    title: 'Settings',
    githubToken: config.githubToken || '',
    anthropicKey: config.anthropicKey || '',
    claudeModel: config.claudeModel || 'claude-3-5-sonnet-latest',
    storageLocation: config.storageLocation || 'local', // local or home
    claudeModels: availableModels || []
  });
});

// Route to fetch available models with a given API key
router.post('/fetch-models', async (req, res) => {
  try {
    const { anthropicKey } = req.body;
    
    if (!anthropicKey || !anthropicKey.trim()) {
      return res.status(400).json({ 
        error: 'API key is required',
        models: [] 
      });
    }
    
    const models = await getAnthropicModels(anthropicKey.trim());
    
    if (!models) {
      return res.status(500).json({ 
        error: 'Failed to fetch models',
        models: [] 
      });
    }
    
    res.json({ models });
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(500).json({ 
      error: error.message,
      models: [] 
    });
  }
});

// Save settings
router.post('/', async (req, res) => {
  try {
    const { githubToken, anthropicKey, claudeModel } = req.body;
    
    const config = {
      githubToken: githubToken.trim(),
      anthropicKey: anthropicKey.trim(),
      claudeModel: claudeModel || 'claude-3-5-sonnet-latest'
    };

    // Check if GitHub token is valid by making a test request
    if (githubToken) {
      try {
        const response = await fetch('https://api.github.com/user', {
          headers: {
            'Authorization': `token ${githubToken}`,
            'User-Agent': 'what-have-i-done'
          }
        });
        
        if (!response.ok) {
          throw new Error('Invalid GitHub token');
        }
      } catch (error) {
        req.flash('error', `GitHub token validation failed: ${error.message}`);
        return res.redirect('/settings');
      }
    } else {
      req.flash('warning', 'GitHub token is required to generate activity reports');
    }

    // Save configuration to home directory
    const configDir = join(homedir(), '.what-have-i-done');
    
    // Create directory if it doesn't exist
    if (!existsSync(configDir)) {
      await fs.mkdir(configDir, { recursive: true });
    }
    
    await fs.writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(config, null, 2),
      'utf8'
    );

    req.flash('success', 'Settings saved successfully');
    res.redirect('/');
  } catch (error) {
    console.error('Error saving settings:', error);
    req.flash('error', `Failed to save settings: ${error.message}`);
    res.redirect('/settings');
  }
});

export default router;