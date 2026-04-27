import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import fs from 'node:fs';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

app.use(express.json({ limit: '50mb' }));

/**
 * Endpoint to save generated theme reports for the CLI tool
 */
app.post('/api/save-report', (req, res) => {
  const { report } = req.body;
  if (!report) {
    res.status(400).send('No report provided');
    return;
  }

  // VERIFY THE JSON: Ensure what we are about to save is actually valid JSON
  try {
    JSON.parse(report);
  } catch (e) {
    console.error('❌ Rejecting report: Not valid JSON');
    res.status(400).send('Invalid JSON format');
    return;
  }

  // Use process.cwd() to ensure we find the project root regardless of where the server is bundled
  const rootDir = process.cwd();
  const userDataDir = join(rootDir, 'user_data');
  const filePath = join(userDataDir, 'last-generated-report.json');

  try {
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, report);
    console.log(`✅ Saved generated report to ${filePath}`);
    res.status(200).json({ path: filePath });
  } catch (err) {
    console.error('❌ Failed to save report:', err);
    res.status(500).send('Internal Server Error');
  }
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
