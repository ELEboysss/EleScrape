/**
 * Library usage — capture traffic programmatically instead of shelling out.
 *
 *   node examples/basic-usage.mjs
 *
 * Start examples/demo-server.js first, or point `url` at any page.
 */
import { capture } from '../src/index.js';

const result = await capture({
  url: process.env.TARGET_URL || 'http://127.0.0.1:8089/',
  out: new URL('../.scrape/example', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  include: [/\/api\//],
  navigate: true,
  // Stop on whichever comes first: 15s elapsed, or 5s without new traffic.
  duration: 15,
  idle: 5,
  level: 'info',
  onRecord(record) {
    console.log(`[${record.id}] ${record.status} ${record.method} ${record.url}`);
  },
});

console.log('\nsummary:', JSON.stringify(result.summary, null, 2));
