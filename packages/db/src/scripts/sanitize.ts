import { fetchSanitizeAndSeed } from '../ingest/sanitize.js';

fetchSanitizeAndSeed({ closeOnComplete: true })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Sanitize and seed failed:', err);
    process.exit(1);
  });
