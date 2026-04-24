import { fetchFmpReal } from './real.js';
import { fetchFmpMock } from './mock.js';

export async function getFmpSnapshot(options = {}) {
  const real = await fetchFmpReal(options);
  if (real.configured && real.available) {
    return real;
  }

  if (real.configured) {
    return fetchFmpMock({
      configured: true,
      available: true,
      message: `${real.message} 已切换到 mock fallback。`,
      fallback_reason: real.message
    });
  }

  return fetchFmpMock();
}
