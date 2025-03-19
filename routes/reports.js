import express from 'express';
import { getReports, loadReport, deleteReport, saveReport } from '../lib/reports/manager.js';
import { generateSummary } from '../lib/anthropic.js';

const router = express.Router();

// List all reports
router.get('/', async (req, res) => {
  try {
    const reports = await getReports();
    
    res.render('reports-list', {
      title: 'Saved Reports',
      reports
    });
  } catch (error) {
    console.error('Error loading reports list:', error);
    req.flash('error', `Failed to load reports: ${error.message}`);
    res.redirect('/');
  }
});

// View a specific report
router.get('/:id', async (req, res) => {
  try {
    const reportId = req.params.id;
    const reportData = await loadReport(reportId);
    
    if (!reportData) {
      req.flash('error', 'Report not found');
      return res.redirect('/reports');
    }
    
    // Render the activity report template with the loaded data
    res.render('activity-report', {
      title: reportData.metadata.title,
      usernames: reportData.usernames,
      isMultiUser: reportData.isMultiUser,
      startDate: reportData.startDate,
      summary: reportData.summary,
      htmlReport: reportData.htmlReport,
      hasAnthropicKey: !!req.appConfig?.anthropicKey,
      isHistoricalReport: true,
      reportId: reportId
    });
  } catch (error) {
    console.error('Error loading report:', error);
    req.flash('error', `Failed to load report: ${error.message}`);
    res.redirect('/reports');
  }
});

// Delete a report
router.post('/:id/delete', async (req, res) => {
  try {
    const reportId = req.params.id;
    const success = await deleteReport(reportId);
    
    if (success) {
      req.flash('success', 'Report deleted successfully');
    } else {
      req.flash('error', 'Failed to delete report');
    }
    
    res.redirect('/reports');
  } catch (error) {
    console.error('Error deleting report:', error);
    req.flash('error', `Failed to delete report: ${error.message}`);
    res.redirect('/reports');
  }
});

// Regenerate summary for a report
router.post('/:id/regenerate-summary', async (req, res) => {
  try {
    if (!req.appConfig?.anthropicKey) {
      req.flash('error', 'Anthropic API key is required to generate summaries');
      return res.redirect(`/reports/${req.params.id}`);
    }

    const reportId = req.params.id;
    const reportData = await loadReport(reportId);
    
    if (!reportData) {
      req.flash('error', 'Report not found');
      return res.redirect('/reports');
    }
    
    console.log(`Regenerating summary for report ${reportId}`);
    
    try {
      // Use the stored plainTextReport for summary generation
      const plainText = reportData.plainTextReport;
      
      if (!plainText) {
        throw new Error('Report does not contain plaintext data required for summary generation');
      }
      
      // Generate a new summary with the configured model
      const summary = await generateSummary(
        plainText,
        req.appConfig.anthropicKey,
        reportData.isMultiUser,
        reportData.usernames,
        req.appConfig.claudeModel || 'claude-3-5-sonnet-latest' // Use configured model or default
      );
      
      // Update the report with the new summary
      reportData.summary = summary;
      reportData.metadata.hasSummary = true;
      
      // Save the updated report
      await saveReport(reportData);
      
      req.flash('success', 'Summary regenerated successfully');
    } catch (summaryError) {
      console.error('Error regenerating summary:', summaryError);
      req.flash('error', `Failed to regenerate summary: ${summaryError.message}`);
    }
    
    res.redirect(`/reports/${reportId}`);
  } catch (error) {
    console.error('Error processing regenerate summary request:', error);
    req.flash('error', `Failed to process request: ${error.message}`);
    res.redirect('/reports');
  }
});

export default router;