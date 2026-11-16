import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = new URL('../.local/', import.meta.url);
await mkdir(directory, { recursive: true });
const password = () => randomBytes(32).toString('hex');
const contents = [
  '# Local Docker profile. Keep this file while its PostgreSQL volume exists.',
  'TIREK_DOCKER_DB_PASSWORD=' + password(),
  'TIREK_DOCKER_POSTGRES_PASSWORD=' + password(),
  'TIREK_DOCKER_MAIL_ENCRYPTION_KEY=' + password(),
  '# TIREK_DOCKER_HTTPS_PORT=9443',
  '# TIREK_DOCKER_REGISTRATION_ENABLED=true',
  '# TIREK_DOCKER_TELEGRAM_DELIVERY=disabled',
  '# TIREK_DOCKER_TELEGRAM_BOT_TOKEN=',
  '',
].join('\n');

try {
  await writeFile(new URL('docker.env', directory), contents, { flag: 'wx', mode: 0o600 });
  console.log('Created .local/docker.env for Docker Compose.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Using existing .local/docker.env.');
}
