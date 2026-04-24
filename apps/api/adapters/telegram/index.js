import { getTelegramStatus, sendTelegramReal, getTelegramUpdates } from './real.js';
import { sendTelegramMock } from './mock.js';

export async function getTelegramSnapshot() {
  const real = getTelegramStatus();
  return real.configured ? real : sendTelegramMock();
}

export async function sendTelegramTestMessage(text) {
  const status = getTelegramStatus();
  if (!status.configured) {
    return sendTelegramMock();
  }
  return sendTelegramReal({ text });
}

export async function fetchTelegramUpdates() {
  return getTelegramUpdates();
}
