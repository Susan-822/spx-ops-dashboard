import { ACTIONS } from "./action-enum.js";

export const NORMALIZED_SIGNAL_VERSION = "0.1.0";

export function createNormalizedSignal(partial = {}) {
  const now = new Date().toISOString();

  return {
    schema_version: NORMALIZED_SIGNAL_VERSION,
    generated_at: partial.generated_at ?? now,
    is_mock: partial.is_mock ?? true,
    symbol: partial.symbol ?? "SPX",
    timeframe: partial.timeframe ?? "1D",
    action: partial.action ?? ACTIONS.HOLD,
    confidence: partial.confidence ?? 0,
    thesis:
      partial.thesis ??
      "Architecture skeleton only. No live market signal logic is implemented.",
    source_status: partial.source_status ?? [],
    gamma_summary: {
      regime: partial.gamma_summary?.regime ?? "unknown",
      summary:
        partial.gamma_summary?.summary ?? "Gamma summary skeleton response.",
      is_mock: partial.gamma_summary?.is_mock ?? true
    },
    events: partial.events ?? [],
    warnings:
      partial.warnings ?? [
        "Mock fallback response. Configure adapters before relying on outputs."
      ],
    metadata: {
      environment: partial.metadata?.environment ?? "local",
      adapters_used: partial.metadata?.adapters_used ?? [],
      notes: partial.metadata?.notes ?? ["No real API calls executed."]
    }
  };
}
