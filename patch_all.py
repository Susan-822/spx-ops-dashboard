import re

# 1. Flow Behavior Engine
path_flow = 'apps/api/decision_engine/algorithms/flow-behavior-engine.js'
with open(path_flow, 'r') as f:
    code = f.read()

code = re.sub(
    r'export function buildFlowBehaviorEngine\(\{[\s\S]*?put_call_ratio = null,[\s\S]*?prem_ticks = \[\],',
    '''export function buildFlowBehaviorEngine({
  net_premium = null,
  call_premium = null,
  put_premium = null,
  put_call_ratio = null,
  pc_volume_ratio = null,
  pc_premium_ratio = null,
  pc_primary_ratio = null,
  directional_net_premium = null,
  prem_ticks = [],''',
    code
)

code = re.sub(
    r'const netPrem = safeNumber\(net_premium\);\s*const callPrem = safeNumber\(call_premium\);\s*const putPrem = safeNumber\(put_premium\);\s*const pcRatio = safeNumber\(put_call_ratio\);',
    '''const netPrem = safeNumber(net_premium);
  const callPrem = safeNumber(call_premium);
  const putPrem = safeNumber(put_premium);
  const pcRatio = safeNumber(put_call_ratio);
  const pcVol = safeNumber(pc_volume_ratio);
  const pcPremRatio = safeNumber(pc_premium_ratio);
  const pcPrimary = safeNumber(pc_primary_ratio) ?? pcRatio;
  const dirNetPrem = safeNumber(directional_net_premium) ?? netPrem;''',
    code
)

code = re.sub(
    r'net_premium: netPrem,\s*net_premium_millions: safeMillions\(netPrem\),\s*call_premium: callPrem,\s*put_premium: putPrem,\s*put_call_ratio: pcRatio,',
    '''net_premium: netPrem,
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
    flow_narrative: behavior === 'put_squeezed' ? 'Put 偏重，但跌不动，空头动能降级，LOCKED。' : dualWindowNarrative,''',
    code
)

with open(path_flow, 'w') as f:
    f.write(code)
print("flow-behavior-engine.js patched")

# 2. Current Signal
path_signal = 'apps/api/decision_engine/current-signal.js'
with open(path_signal, 'r') as f:
    code = f.read()

code = re.sub(
    r'const flowBehaviorEngine = buildFlowBehaviorEngine\(\{\s*net_premium: _netPrem5m,\s*call_premium: _callPrem5m,\s*put_premium: _putPrem5m,\s*put_call_ratio: _pcRatio,\s*prem_ticks: \[\],',
    '''const flowBehaviorEngine = buildFlowBehaviorEngine({
    net_premium: _netPrem5m,
    call_premium: _callPrem5m,
    put_premium: _putPrem5m,
    put_call_ratio: _pcRatio,
    pc_volume_ratio: _ff.pc_volume_ratio ?? _pcRatio,
    pc_premium_ratio: _ff.pc_premium_ratio ?? null,
    pc_primary_ratio: _ff.pc_primary_ratio ?? _pcRatio,
    directional_net_premium: _ff.directional_net_premium ?? _netPrem5m,
    prem_ticks: [],''',
    code
)

with open(path_signal, 'w') as f:
    f.write(code)
print("current-signal.js patched")

# 3. AB Order Engine
path_ab = 'apps/api/decision_engine/algorithms/ab-order-engine.js'
with open(path_ab, 'r') as f:
    code = f.read()

code = re.sub(
    r'return \{\s*status: finalStatus,',
    '''// Final Decision Gate
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
    status: finalStatus,''',
    code
)

with open(path_ab, 'w') as f:
    f.write(code)
print("ab-order-engine.js patched")

