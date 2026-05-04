const fs = require('fs');
const path = 'apps/api/decision_engine/current-signal.js';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  /const flowBehaviorEngine = buildFlowBehaviorEngine\(\{\s*net_premium: _netPrem5m,\s*call_premium: _callPrem5m,\s*put_premium: _putPrem5m,\s*put_call_ratio: _pcRatio,\s*prem_ticks: \[\],/m,
  `const flowBehaviorEngine = buildFlowBehaviorEngine({
    net_premium: _netPrem5m,
    call_premium: _callPrem5m,
    put_premium: _putPrem5m,
    put_call_ratio: _pcRatio,
    pc_volume_ratio: _ff.pc_volume_ratio ?? _pcRatio,
    pc_premium_ratio: _ff.pc_premium_ratio ?? null,
    pc_primary_ratio: _ff.pc_primary_ratio ?? _pcRatio,
    directional_net_premium: _ff.directional_net_premium ?? _netPrem5m,
    prem_ticks: [],`
);

fs.writeFileSync(path, code);
console.log('current-signal.js patched');
