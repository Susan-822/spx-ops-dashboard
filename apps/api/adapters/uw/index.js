import { fetchUwReal } from './real.js';
import { fetchUwMock } from './mock.js';

export async function getUwSnapshot() {
  const real = await fetchUwReal();
  return real.configured ? real : fetchUwMock();
}
