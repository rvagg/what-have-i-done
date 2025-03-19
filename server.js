import express from 'express';
import session from 'express-session';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import flash from 'connect-flash';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import expressLayouts from 'express-ejs-layouts';

// Import routes
import indexRoutes from './routes/index.js';
import activityRoutes from './routes/activity.js';
import settingsRoutes from './routes/settings.js';
import apiRoutes from './routes/api.js';
import reportsRoutes from './routes/reports.js';

// Setup __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

// Initialize the app
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

// Configure view engine
app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));

// Set up EJS layouts
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

// Middleware
app.use(express.static(join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'github-activity-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Flash messages
app.use(flash());

// Middleware to check for configuration and pass to views
app.use(async (req, res, next) => {
  try {
    // Check for credentials in home directory
    let config = null;
    const configPath = join(homedir(), '.what-have-i-done', 'config.json');
    
    if (existsSync(configPath)) {
      const configData = await fs.readFile(configPath, 'utf8');
      config = JSON.parse(configData);
    }

    // Set on app locals for access in templates
    res.locals.hasConfig = !!config;
    res.locals.hasGithubToken = config?.githubToken ? true : false;
    res.locals.hasAnthropicKey = config?.anthropicKey ? true : false;
    res.locals.flashMessages = req.flash();
    
    // Store config for route handlers to use
    req.appConfig = config;

    next();
  } catch (error) {
    console.error('Error loading configuration:', error);
    res.locals.hasConfig = false;
    res.locals.hasGithubToken = false;
    res.locals.hasAnthropicKey = false;
    res.locals.flashMessages = req.flash();
    next();
  }
});

// Routes
app.use('/', indexRoutes);
app.use('/activity', activityRoutes);
app.use('/settings', settingsRoutes);
app.use('/api', apiRoutes);
app.use('/reports', reportsRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { 
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// Start the server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});