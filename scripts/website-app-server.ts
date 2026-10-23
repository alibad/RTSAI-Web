/** Local app entry: serve the built website and open Play through Studio's verified-build contract. */
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentPlayEntry } from '../lib/content-play-entry';
import { proxyTo } from '../lib/play-proxy';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const website = proxyTo(new URL('http://127.0.0.1:3452'), 'The local website is starting. Please reload.');
const entry = contentPlayEntry(root, website);
createServer((req, res) => { void entry(req, res); }).listen(3451, '127.0.0.1', () => {
  console.log('RTS AI Website app: http://127.0.0.1:3451/');
});
