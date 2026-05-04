const fs = require('fs');
const path = 'apps/api/decision_engine/algorithms/ab-order-engine.js';
let code = fs.readFileSync(path, 'utf8');

// 在返回之前插入 final guard
code = code.replace(
  /return \{[\s\S]*?status: finalStatus,/m,
  `// Final Decision Gate
  if (finalStatus === 'blocked' || finalStatus === 'wait') {
    allowTrade = false;
    tradeSide = 'NONE';
    directionalLabel = '观察';
    if (finalStatus === 'blocked' && forcedWaitReason === 'put_squeezed') {
      momentumLabel = '降级';
    } else {
      momentumLabel = '降级';
    }
  }

  return {
    status: finalStatus,`
);

fs.writeFileSync(path, code);
console.log('ab-order-engine.js patched');
