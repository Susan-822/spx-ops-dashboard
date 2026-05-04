import re

path_app = 'apps/web/app.js'
with open(path_app, 'r') as f:
    code = f.read()

# 1. 移除 GEX PROFILE 的渲染
code = re.sub(
    r'<div class="primary-card-gex">\$\{renderGexUrgencyChart\(signal\)\}<\/div>',
    '',
    code
)

# 2. 修改资金状态显示 (ZONE 04)
code = re.sub(
    r'<span class="stat-item">P\/C：<strong>\$\{escapeHtml\(pcRatio\)\}<\/strong><\/span>\s*<span class="stat-sep">｜<\/span>\s*<span class="stat-item">Net Premium：<strong>\$\{escapeHtml\(netPremFmt\)\}<\/strong><\/span>',
    '''<div class="flow-stats-new">
                <div class="stat-row"><span class="stat-label">P/C Volume:</span><span class="stat-val">${escapeHtml(fb2.pc_volume_ratio ?? pcRatio)}</span></div>
                <div class="stat-row"><span class="stat-label">P/C Premium:</span><span class="stat-val">${escapeHtml(fb2.pc_premium_ratio ?? '--')}</span></div>
                <div class="stat-row"><span class="stat-label">P/C Primary:</span><span class="stat-val">${escapeHtml(fb2.pc_primary_ratio ?? pcRatio)}</span></div>
                <div class="stat-row"><span class="stat-label">Directional Net Premium:</span><span class="stat-val">${escapeHtml(fb2.directional_net_premium != null ? (fb2.directional_net_premium / 1e6).toFixed(1) + 'M' : netPremFmt)}</span></div>
                <div class="stat-row"><span class="stat-label">Flow 状态:</span><span class="stat-val">${escapeHtml(fb2.flow_narrative ?? '--')}</span></div>
              </div>''',
    code
)

# 3. LOCKED 状态下禁用主做/备选 Tabs
code = re.sub(
    r'const mainTabLabel = \(!planA2 \|\| dirA2 === \'WAIT\'\) \? \'主做\' : \(aIsBull2 \? \'多单\' : \'空单\'\);\s*const altTabLabel  = \(!planB2 \|\| dirB2 === \'WAIT\'\) \? \'备选\' : \(bIsBull2 \? \'备选（多）\' : \'备选（空）\'\);',
    '''const isLocked = abStatus2 === 'blocked' || abStatus2 === 'wait';
                const mainTabLabel = isLocked ? '主做(禁)' : (!planA2 || dirA2 === 'WAIT') ? '主做' : (aIsBull2 ? '多单' : '空单');
                const altTabLabel  = isLocked ? '备选(禁)' : (!planB2 || dirB2 === 'WAIT') ? '备选' : (bIsBull2 ? '备选（多）' : '备选（空）');''',
    code
)

code = re.sub(
    r'<button class="ptab-btn" data-tab="main">\$\{escapeHtml\(mainTabLabel\)\}<\/button>\s*<button class="ptab-btn" data-tab="alt">\$\{escapeHtml\(altTabLabel\)\}<\/button>',
    '''${isLocked ? '' : `<button class="ptab-btn" data-tab="main">${escapeHtml(mainTabLabel)}</button>
                    <button class="ptab-btn" data-tab="alt">${escapeHtml(altTabLabel)}</button>`}''',
    code
)

with open(path_app, 'w') as f:
    f.write(code)
print("app.js patched")

