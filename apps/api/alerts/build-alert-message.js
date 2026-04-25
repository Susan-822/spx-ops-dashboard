import { buildTradePlanTelegramMessage } from './telegram-plan-alert.js';

export function buildAlertMessage({ signal, body = {} }) {
  return buildTradePlanTelegramMessage({ signal, body });
}
