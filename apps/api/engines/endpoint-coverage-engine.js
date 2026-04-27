export function buildEndpointCoverageReport(coverage = {}) {
  const empty = {
    required: [],
    ok: [],
    failed: [],
    missing: []
  };
  return {
    dealer_gex: { ...empty, ...(coverage.dealer_gex || {}) },
    flow: { ...empty, ...(coverage.flow || {}) },
    darkpool: { ...empty, ...(coverage.darkpool || {}) },
    sentiment: { ...empty, ...(coverage.sentiment || {}) },
    volatility: { ...empty, ...(coverage.volatility || {}) },
    technical: { ...empty, ...(coverage.technical || {}) }
  };
}
