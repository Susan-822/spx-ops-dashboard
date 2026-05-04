const fs = require('fs');
const path = 'apps/api/decision_engine/algorithms/flow-behavior-engine.js';
let code = fs.readFileSync(path, 'utf8');

// 1. 添加 P/C Volume, P/C Premium, P/C Primary, Directional Net Premium
code = code.replace(
  /export function buildFlowBehaviorEngine\(\{[\s\S]*?put_call_ratio = null,[\s\S]*?prem_ticks = \[\],/m,
  `export function buildFlowBehaviorEngine({
  net_premium = null,
  call_premium = null,
  put_premium = null,
  put_call_ratio = null,
  pc_volume_ratio = null,
  pc_premium_ratio = null,
  pc_primary_ratio = null,
  directional_net_premium = null,
  prem_ticks = [],`
);

// 2. 在 buildFlowBehaviorEngine 内部使用这些字段
code = code.replace(
  /const netPrem = safeNumber\(net_premium\);\s*const callPrem = safeNumber\(call_premium\);\s*const putPrem = safeNumber\(put_premium\);\s*const pcRatio = safeNumber\(put_call_ratio\);/m,
  `const netPrem = safeNumber(net_premium);
  const callPrem = safeNumber(call_premium);
  const putPrem = safeNumber(put_premium);
  const pcRatio = safeNumber(put_call_ratio);
  const pcVol = safeNumber(pc_volume_ratio);
  const pcPremRatio = safeNumber(pc_premium_ratio);
  const pcPrimary = safeNumber(pc_primary_ratio) ?? pcRatio;
  const dirNetPrem = safeNumber(directional_net_premium) ?? netPrem;`
);

// 3. 修改返回字段
code = code.replace(
  /net_premium: netPrem,\s*net_premium_millions: safeMillions\(netPrem\),\s*call_premium: callPrem,\s*put_premium: putPrem,\s*put_call_ratio: pcRatio,/m,
  `net_premium: netPrem,
    net_premium_millions: safeMillions(netPrem),
    directional_net_premium: dirNetPrem,
    call_premium_abs: callPrem != null ? Math.abs(callPrem) : null,
    put_premium_abs: putPrem != null ? Math.abs(putPrem) : null,
    put_call_ratio: pcRatio,
    pc_volume_ratio: pcVol,
    pc_premium_ratio: pcPremRatio,
    pc_primary_ratio: pcPrimary,
    flow_state: behavior === 'put_squeezed' ? 'PUT_HEAVY_ABSORBED' : behavior.toUpperCase(),
    flow_quality: (flow5m.is_fallback || flow15m.is_fallback || (flow5m.delta != null && flow5m.delta === flow15m.delta)) ? 'DEGRADED' : 'NORMAL',
    flow_narrative: behavior === 'put_squeezed' ? 'Put 偏重，但跌不动，空头动能降级，LOCKED。' : dualWindowNarrative,`
);

fs.writeFileSync(path, code);
console.log('Flow behavior engine patched');
