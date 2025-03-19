import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { format } from 'date-fns';

// Get path to data directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDirectory = path.resolve(__dirname, '../../data/reports');

/**
 * Saves a report to the filesystem
 * @param {Object} reportData - The report data to save
 * @returns {Promise<string>} - The ID of the saved report
 */
export async function saveReport(reportData) {
  try {
    console.log(`Saving report to directory: ${dataDirectory}`);
    
    // Create reports directory if it doesn't exist
    if (!existsSync(dataDirectory)) {
      console.log('Reports directory does not exist, creating it...');
      await fs.mkdir(dataDirectory, { recursive: true });
    }
    
    // Generate a timestamp-based ID
    const timestamp = new Date().toISOString();
    const id = timestamp.replace(/[:.]/g, '-');
    console.log(`Generated report ID: ${id}`);
    
    // Create report metadata
    const metadata = {
      id,
      timestamp,
      createdAt: new Date().toISOString(),
      usernames: reportData.usernames || [],
      isMultiUser: reportData.isMultiUser || false,
      startDate: reportData.startDate,
      hasSummary: !!reportData.summary,
      title: generateReportTitle(reportData),
      description: generateReportDescription(reportData)
    };
    
    console.log(`Report metadata: ${JSON.stringify({
      id: metadata.id,
      title: metadata.title,
      usernames: metadata.usernames
    })}`);
    
    // Save the full report data
    const filePath = path.join(dataDirectory, `${id}.json`);
    console.log(`Writing report to: ${filePath}`);
    
    await fs.writeFile(
      filePath,
      JSON.stringify({ ...reportData, metadata }, null, 2)
    );
    
    console.log('Report saved successfully');
    return id;
  } catch (error) {
    console.error('Error saving report:', error);
    throw new Error(`Failed to save report: ${error.message}`);
  }
}

/**
 * Loads a report by ID
 * @param {string} id - The ID of the report to load
 * @returns {Promise<Object>} - The report data
 */
export async function loadReport(id) {
  try {
    const filePath = path.join(dataDirectory, `${id}.json`);
    
    if (!existsSync(filePath)) {
      throw new Error(`Report with ID ${id} not found`);
    }
    
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading report:', error);
    throw new Error(`Failed to load report: ${error.message}`);
  }
}

/**
 * Gets a list of all saved reports
 * @returns {Promise<Array>} - Array of report metadata
 */
export async function getReports() {
  try {
    console.log(`Looking for reports in directory: ${dataDirectory}`);
    
    // Create reports directory if it doesn't exist
    if (!existsSync(dataDirectory)) {
      console.log('Reports directory does not exist, creating it...');
      await fs.mkdir(dataDirectory, { recursive: true });
      return [];
    }
    
    // Get all report files
    const files = await fs.readdir(dataDirectory);
    console.log(`Found ${files.length} files in reports directory:`, files);
    
    const reportFiles = files.filter(file => file.endsWith('.json'));
    console.log(`Found ${reportFiles.length} JSON report files:`, reportFiles);
    
    if (reportFiles.length === 0) {
      return [];
    }
    
    // Load metadata from each report
    const reports = await Promise.all(
      reportFiles.map(async (file) => {
        try {
          const filePath = path.join(dataDirectory, file);
          console.log(`Reading report file: ${filePath}`);
          
          const data = await fs.readFile(filePath, 'utf8');
          const reportData = JSON.parse(data);
          
          if (!reportData.metadata) {
            console.error(`No metadata found in report file ${file}`);
            return null;
          }
          
          console.log(`Loaded report metadata for ID: ${reportData.metadata.id}`);
          return reportData.metadata;
        } catch (err) {
          console.error(`Error reading report file ${file}:`, err);
          return null;
        }
      })
    );
    
    // Filter out any failed reads and sort by timestamp (newest first)
    const validReports = reports
      .filter(report => report !== null)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    console.log(`Returning ${validReports.length} valid reports`);
    return validReports;
  } catch (error) {
    console.error('Error getting reports:', error);
    return [];
  }
}

/**
 * Deletes a report by ID
 * @param {string} id - The ID of the report to delete
 * @returns {Promise<boolean>} - Whether the deletion was successful
 */
export async function deleteReport(id) {
  try {
    const filePath = path.join(dataDirectory, `${id}.json`);
    
    if (!existsSync(filePath)) {
      throw new Error(`Report with ID ${id} not found`);
    }
    
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    console.error('Error deleting report:', error);
    return false;
  }
}

/**
 * Generates a title for the report
 * @param {Object} reportData - The report data
 * @returns {string} - The report title
 */
function generateReportTitle(reportData) {
  const usernames = reportData.usernames || [];
  const startDate = new Date(reportData.startDate);
  const formattedDate = format(startDate, 'MMM d, yyyy');
  const creationDate = format(new Date(), 'MMM d, yyyy HH:mm');
  
  if (reportData.isMultiUser) {
    if (usernames.length <= 3) {
      return `${usernames.join(', ')} activity since ${formattedDate} (${creationDate})`;
    } else {
      return `${usernames.length} users activity since ${formattedDate} (${creationDate})`;
    }
  } else {
    return `@${usernames[0]} activity since ${formattedDate} (${creationDate})`;
  }
}

/**
 * Generates a description for the report
 * @param {Object} reportData - The report data
 * @returns {string} - The report description
 */
function generateReportDescription(reportData) {
  const usernames = reportData.usernames || [];
  const startDate = new Date(reportData.startDate);
  const formattedStartDate = format(startDate, 'MMMM d, yyyy');
  const currentDate = format(new Date(), 'MMMM d, yyyy');
  const hasSummary = !!reportData.summary;
  
  let description = '';
  
  // User information
  if (reportData.isMultiUser) {
    if (usernames.length <= 5) {
      description += `GitHub activity for ${usernames.join(', ')}`;
    } else {
      const shownUsers = usernames.slice(0, 3);
      description += `GitHub activity for ${shownUsers.join(', ')} and ${usernames.length - 3} more users`;
    }
  } else {
    description += `GitHub activity for @${usernames[0]}`;
  }
  
  // Date range
  description += ` from ${formattedStartDate} to ${currentDate}`;
  
  // Summary info
  if (hasSummary) {
    description += ' (includes AI summary)';
  }
  
  return description;
}