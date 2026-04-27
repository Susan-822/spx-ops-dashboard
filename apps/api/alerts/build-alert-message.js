import { buildTradePlanTelegramMessage } from './telegram-plan-alert.js';

export function buildAlertMessage({ signal, body = {} }) {
  const base = buildTradePlanTelegramMessage({ signal, body });
  const projection = signal?.projection || {};
  const extras = [
    signal?.command_center?.plain_chinese ? `状态：${signal.command_center.final_state}` : null,
    signal?.command_center?.action ? `动作：${signal.command_center.action}` : null,
    signal?.command_center?.main_reason ? `原因：${signal.command_center.main_reason}` : null,
    projection.s_level_summary ? `\n${projection.s_level_summary}` : null,
    projection.one_line_instruction ? `一句话：${projection.one_line_instruction}` : null,
    signal?.volume_pressure?.plain_chinese ? `量比：${signal.volume_pressure.plain_chinese}` : null,
    signal?.volatility_activation?.plain_chinese ? `波动：${signal.volatility_activation.plain_chinese}` : null,
    signal?.uw_dealer_greeks?.plain_chinese ? `UW Greeks：${signal.uw_dealer_greeks.plain_chinese}` : null,
    signal?.dealer_path?.plain_chinese ? `Dealer Path：${signal.dealer_path.plain_chinese}` : null
  ].filter(Boolean);
  return extras.length > 0 ? `${base}\n${extras.join('\n')}` : base;
}
