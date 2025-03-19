import express from 'express';

const router = express.Router();

// Home page route
router.get('/', (req, res) => {
  res.render('index', {
    title: 'GitHub Activity Viewer',
    hasConfig: res.locals.hasConfig,
    hasGithubToken: res.locals.hasGithubToken,
    hasAnthropicKey: res.locals.hasAnthropicKey
  });
});

export default router;