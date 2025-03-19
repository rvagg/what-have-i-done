import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get path to data directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDirectory = path.resolve(__dirname, '../data/cache');
const usernamesFile = path.join(cacheDirectory, 'usernames.json');

/**
 * Get all cached usernames
 * @returns {Promise<string[]>} Array of cached usernames
 */
export async function getCachedUsernames() {
  try {
    // Ensure cache directory exists
    if (!existsSync(cacheDirectory)) {
      await fs.mkdir(cacheDirectory, { recursive: true });
      return [];
    }

    // Check if usernames file exists
    if (!existsSync(usernamesFile)) {
      // Create empty file if it doesn't exist
      await fs.writeFile(usernamesFile, JSON.stringify([], null, 2));
      return [];
    }

    // Read and parse usernames file
    const data = await fs.readFile(usernamesFile, 'utf8');
    const usernames = JSON.parse(data);
    
    // Return usernames sorted alphabetically
    return usernames.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  } catch (error) {
    console.error('Error getting cached usernames:', error);
    return [];
  }
}

/**
 * Add usernames to the cache
 * @param {string[]} newUsernames - Array of usernames to add
 * @returns {Promise<boolean>} Success status
 */
export async function addUsernamesToCache(newUsernames) {
  try {
    if (!newUsernames || !newUsernames.length) {
      return true; // Nothing to do
    }

    // Ensure cache directory exists
    if (!existsSync(cacheDirectory)) {
      await fs.mkdir(cacheDirectory, { recursive: true });
    }

    // Get existing usernames
    let existingUsernames = [];
    if (existsSync(usernamesFile)) {
      const data = await fs.readFile(usernamesFile, 'utf8');
      existingUsernames = JSON.parse(data);
    }

    // Add new usernames (avoiding duplicates)
    const allUsernames = [...new Set([...existingUsernames, ...newUsernames])];
    
    // Write updated usernames back to file
    await fs.writeFile(usernamesFile, JSON.stringify(allUsernames, null, 2));
    
    return true;
  } catch (error) {
    console.error('Error adding usernames to cache:', error);
    return false;
  }
}

/**
 * Remove a username from the cache
 * @param {string} username - Username to remove
 * @returns {Promise<boolean>} Success status
 */
export async function removeUsernameFromCache(username) {
  try {
    if (!username || !existsSync(usernamesFile)) {
      return false;
    }

    // Get existing usernames
    const data = await fs.readFile(usernamesFile, 'utf8');
    const existingUsernames = JSON.parse(data);

    // Filter out the username to remove
    const updatedUsernames = existingUsernames.filter(name => name !== username);

    // Write updated usernames back to file
    await fs.writeFile(usernamesFile, JSON.stringify(updatedUsernames, null, 2));
    
    return true;
  } catch (error) {
    console.error('Error removing username from cache:', error);
    return false;
  }
}