import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist-web');
await mkdir(output, { recursive: true });
await Promise.all(
  ['manifest.json', 'sw.js', 'ximo-icon.png'].map((file) =>
    cp(resolve(root, 'public', file), resolve(output, file)),
  ),
);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : path;
    }),
  );
  return files.flat();
}

const appShell = (await listFiles(output))
  .filter((file) => !file.endsWith(`${sep}sw.js`) && !file.endsWith(`${sep}metadata.json`))
  .map((file) => `/${relative(output, file).split(sep).join('/')}`);
appShell.unshift('/');
const serviceWorkerPath = resolve(output, 'sw.js');
const serviceWorker = await readFile(serviceWorkerPath, 'utf8');
await writeFile(
  serviceWorkerPath,
  serviceWorker.replace(
    /\/\* __XIMO_APP_SHELL__ \*\/ \[[^\]]*\]/,
    JSON.stringify([...new Set(appShell)]),
  ),
);

const indexPath = resolve(output, 'index.html');
const index = await readFile(indexPath, 'utf8');
const headMarkup = [
  '<meta name="theme-color" content="#1A593B" />',
  '<meta name="description" content="Ximo POS — cross-platform point of sale with offline support." />',
  '<link rel="manifest" href="/manifest.json" />',
  '<link rel="apple-touch-icon" href="/ximo-icon.png" />',
].join('');
if (!index.includes('rel="manifest"')) {
  await writeFile(indexPath, index.replace('<head>', `<head>${headMarkup}`));
}
