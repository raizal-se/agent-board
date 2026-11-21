import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Build the page once, as the CLI serves it (apps/web/dist). */
export default function globalSetup() {
  const web = fileURLToPath(new URL('..', import.meta.url));
  execFileSync('node_modules/.bin/vite', ['build'], { cwd: web, stdio: 'inherit' });
}
