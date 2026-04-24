import { fetchThetaReal } from './real.js';
import { fetchThetaMock } from './mock.js';

export async function getThetaSnapshot() {
  const real = await fetchThetaReal();
  return real.configured ? real : fetchThetaMock();
}
