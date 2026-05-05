import { evaluate0dteMicrostructure, buildMicrostructureRead } from '../apps/api/decision_engine/algorithms/microstructure-validation-engine.js';

// 构造 60 笔 mock 数据：45 call bid_side + 5 call ask_side + 10 put ask_side
const mockRows = [];
for (let i = 0; i < 45; i++) {
  mockRows.push({ id: `cb-${i}`, option_type: 'call', tags: ['bid_side'], premium: 4_000_000, underlying_price: 7255, timestamp: new Date(Date.now() - (60-i)*700).toISOString() });
}
for (let i = 0; i < 5; i++) {
  mockRows.push({ id: `ca-${i}`, option_type: 'call', tags: ['ask_side'], premium: 4_000_000, underlying_price: 7255, timestamp: new Date(Date.now() - (15-i)*700).toISOString() });
}
for (let i = 0; i < 10; i++) {
  mockRows.push({ id: `pa-${i}`, option_type: 'put', tags: ['ask_side'], premium: 1_000_000, underlying_price: 7255, timestamp: new Date(Date.now() - (10-i)*700).toISOString() });
}

const raw = evaluate0dteMicrostructure({ flowRecentTicks: mockRows, greekRows: [], netGex: 173000, spotPrice: 7255, ifvgBreached: false, windowMs: 300_000 });
console.log('raw result:', JSON.stringify(raw, null, 2));

const read = buildMicrostructureRead(raw);
console.log('\nread result:', JSON.stringify(read, null, 2));
