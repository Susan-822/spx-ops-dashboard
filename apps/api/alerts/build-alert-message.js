function inferSession({ body = {}, signal }) {
  const requestedSession = String(body.session || '').toLowerCase();
  if (requestedSession === 'premarket' || requestedSession === '盘前') {
    return 'premarket';
  }
  if (requestedSession === 'intraday' || requestedSession === '盘中') {
    return 'intraday';
  }

  const timestamp = body.now || signal?.timestamp || new Date().toISOString();
  const hour = new Date(timestamp).getUTCHours();
  return hour < 13 || hour >= 20 ? 'premarket' : 'intraday';
}

function sessionLabel(session) {
  return session === 'premarket' ? '盘前提醒' : '盘中提醒';
}

function isFmpAbnormal(signal) {
  const fmp = (signal?.source_status || []).find((item) => item.source === 'fmp_event');
  if (!fmp) {
    return false;
  }
  if (!fmp.configured) {
    return false;
  }
  return ['degraded', 'delayed', 'down'].includes(fmp.state) || fmp.is_mock === true || fmp.stale === true;
}

function actionLabel(signal) {
  switch (signal?.recommended_action) {
    case 'income_ok':
      return '仅在波动继续回落时，谨慎评估收入型策略';
    case 'long_on_pullback':
      return '等回踩不破关键位，再考虑偏多';
    case 'short_on_retest':
      return '等反抽受阻，再考虑偏空';
    case 'no_trade':
      return '暂停交易，先解决数据质量问题';
    default:
      return '先等待，不抢先出手';
  }
}

function avoidLabel(signal) {
  const avoid = Array.isArray(signal?.avoid_actions) ? signal.avoid_actions : [];
  if (signal?.event_context?.event_risk === 'high') {
    return '不要提前铁鹰，不要裸卖，不要把事件窗口当成稳定区间。';
  }
  if (signal?.stale_flags?.any_stale) {
    return '不要用过期数据直接执行。';
  }
  if (avoid.length === 0) {
    return '不要追单，先等确认。';
  }
  return signal?.plain_language?.avoid || '不要追单，先等确认。';
}

function reasonLabel(session, signal) {
  if (signal?.event_context?.event_risk === 'high') {
    return signal.event_context.event_note;
  }
  if (session === 'premarket') {
    return `盘前先看风险闸门与关键位，${signal?.plain_language?.market_status || '当前先观察。'}`;
  }
  return signal?.plain_language?.market_status || '盘中暂时没有足够优势，先观察。';
}

export function buildAlertMessage({ signal, body = {} }) {
  const session = inferSession({ body, signal });
  const signalSummary = signal?.signals || {};
  if (isFmpAbnormal(signal)) {
    return [
      '【SPX 指挥台｜事件风险】',
      '状态：FMP 异常',
      '事件：无法确认',
      '动作：降低交易权限，不提前铁鹰，不裸卖波',
      '影响：事件风险不可确认',
      '禁做：不要把未知事件窗口当成安全区间',
      '原因：FMP 数据异常或过期'
    ].join('\n');
  }

  return [
    '【SPX 指挥台】',
    `状态：${sessionLabel(session)}`,
    `动作：${actionLabel(signal)}`,
    `触发：${signal?.symbol || 'SPX'} ${signal?.timeframe || '1D'} | ${signalSummary.price_confirmation === 'confirmed' ? '结构已确认' : '结构待确认'}`,
    `作废：${signal?.invalidation_level || '若关键位失守则重新评估'}`,
    `禁做：${avoidLabel(signal)}`,
    `原因：${reasonLabel(session, signal)}`
  ].join('\n');
}
