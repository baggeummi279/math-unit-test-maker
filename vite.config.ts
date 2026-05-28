import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import generateAssessmentHandler from './api/generate-assessment.ts'
import generateCheckTestHandler from './api/generate-check-test.ts'
import diagnoseCheckTestHandler from './api/diagnose-check-test.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env variables (including OPENAI_API_KEY) from .env.local into process.env
  const env = loadEnv(mode, process.cwd(), '');
  process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;

  return {
    plugins: [
      react(),
      {
        name: 'api-serverless-middleware',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const url = req.url || '';
            if (url.startsWith('/api/generate-assessment')) {
              try {
                await generateAssessmentHandler(req, res);
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: `Vite Dev Server API Error: ${message}` }));
              }
            } else if (url.startsWith('/api/generate-check-test')) {
              try {
                await generateCheckTestHandler(req, res);
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: `Vite Dev Server API Error: ${message}` }));
              }
            } else if (url.startsWith('/api/diagnose-check-test')) {
              try {
                await diagnoseCheckTestHandler(req, res);
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: `Vite Dev Server API Error: ${message}` }));
              }
            } else {
              next();
            }
          });
        }
      }
    ]
  }
})
