import { fetchFmpReal } from './real.js';
import { fetchFmpMock } from './mock.js';

export async function getFmpSnapshot() {
  const real = await fetchFmpReal();
  return real.configured ? real : fetchFmpMock();
}
