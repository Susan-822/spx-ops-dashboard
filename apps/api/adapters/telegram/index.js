import { sendTelegramReal } from './real.js';
import { sendTelegramMock } from './mock.js';

export async function getTelegramSnapshot() {
  const real = await sendTelegramReal();
  return real.configured ? real : sendTelegramMock();
}
