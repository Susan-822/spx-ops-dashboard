export function runEventRiskEngine({ event_risk, event_note }) {
  if (event_risk === 'high') {
    return {
      risk_gate: 'blocked',
      blocked_actions: ['income_ok', 'iron_condor', 'naked_sell'],
      event_note
    };
  }

  if (event_risk === 'medium') {
    return {
      risk_gate: 'caution',
      blocked_actions: ['naked_sell'],
      event_note
    };
  }

  return {
    risk_gate: 'open',
    blocked_actions: [],
    event_note
  };
}
