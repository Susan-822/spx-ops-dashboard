import { fetchTradingViewReal } from './real.js';
import { fetchTradingViewMock } from './mock.js';

export async function getTradingViewSnapshot() {
  const real = await fetchTradingViewReal();
  return real.configured ? real : fetchTradingViewMock();
}
