import { normalizeRawNoteInputs } from './normalize-inputs.js';
import { buildFinalDecision } from './final-decision.js';
import { buildStrategyCards, decisionToTelegram } from './formatters.js';

export function runRawNoteV2(input = {}, options = {}) {
  const normalized = normalizeRawNoteInputs(input, options.now || new Date());
  const final_decision = buildFinalDecision(normalized);
  const strategy_cards = buildStrategyCards(final_decision);
  return {
    final_decision,
    fmp_conclusion: normalized.fmp_conclusion,
    uw_conclusion: normalized.uw_conclusion,
    theta_conclusion: normalized.theta_conclusion,
    tv_sentinel: normalized.tv_sentinel,
    price_sources: normalized.price_sources,
    cross_asset_projection: normalized.cross_asset_projection,
    uw_wall_diagnostics: input.uw_wall_diagnostics || {},
    raw_note_v2: {
      version: 'raw-note-v2',
      trace: final_decision.trace,
      allowed_setups: final_decision.allowed_setups,
      data_tier: final_decision.trace.find((item) => item.step === 'data_tier')?.data_tier || null
    },
    allowed_setups: final_decision.allowed_setups,
    blocked_setups_reason: final_decision.blocked_setups_reason || [],
    allowed_setups_reason: final_decision.allowed_setups_reason || [],
    strategy_cards,
    telegram_text: decisionToTelegram({
      final_decision,
      uw_conclusion: normalized.uw_conclusion,
      theta_conclusion: normalized.theta_conclusion,
      price_sources: normalized.price_sources
    })
  };
}

export { buildFinalDecision } from './final-decision.js';
export { normalizeRawNoteInputs } from './normalize-inputs.js';
