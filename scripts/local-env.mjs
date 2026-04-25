import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseEnvText(raw) {
  const entries = {};
  for (const line of String(raw || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator < 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) {
      entries[key] = value;
    }
  }
  return entries;
}

async function tryReadEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return {
      path: filePath,
      values: parseEnvText(raw)
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function loadLocalEnv({
  cwd = process.cwd(),
  windowsDownloadsBridgeEnvPath = null,
  scriptEnvPath = null
} = {}) {
  const windowsHome = process.env.USERPROFILE || 'C:\\Users\\susan';
  const prioritizedPaths = [
    windowsDownloadsBridgeEnvPath || path.join(windowsHome, 'Downloads', 'bridge', '.env'),
    path.join(cwd, 'bridge', '.env'),
    path.join(cwd, '.env'),
    scriptEnvPath || path.join(__dirname, '.env')
  ];

  for (const filePath of prioritizedPaths) {
    const loaded = await tryReadEnvFile(filePath);
    if (!loaded) {
      continue;
    }
    for (const [key, value] of Object.entries(loaded.values)) {
      if (process.env[key] === undefined || process.env[key] === '') {
        process.env[key] = value;
      }
    }
    return {
      env_file_used: loaded.path,
      values: loaded.values,
      searched: prioritizedPaths
    };
  }

  return {
    env_file_used: null,
    values: {},
    searched: prioritizedPaths
  };
}

export function maskPresence(value) {
  return Boolean(value && String(value).trim());
}
