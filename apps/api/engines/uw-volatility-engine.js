function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function runUwVolatilityEngine({ volatilityFactors = {}, institutionalAlert = {} } = {}) {
  const hasVolatilityInput = [
    volatilityFactors.atm_iv,
    volatilityFactors.iv_rank,
    volatilityFactors.iv_percentile,
    volatilityFactors.realized_volatility,
    volatilityFactors.iv_change_5m
  ].some((value) => num(value) != null);
  if (!hasVolatilityInput) {
    return {
      state: 'unavailable',
      light: 'unavailable',
      score: 0,
      strength: 'unavailable',
      single_leg_permission: 'wait',
      vertical_permission: 'wait',
      iron_condor_permission: 'block',
      plain_chinese: 'UW volatility 不可用，不能主导策略权限。'
    };
  }

  const ivRank = num(volatilityFactors.iv_rank);
  const ivPercentile = num(volatilityFactors.iv_percentile);
  const ivChange = num(volatilityFactors.iv_change_5m);
  const realized = num(volatilityFactors.realized_volatility);
  const rawScore = Math.round(
    (ivRank ?? ivPercentile ?? 0) * 0.65
    + (Math.abs(ivChange ?? 0) * 120)
    + (realized != null ? Math.min(realized, 30) : 0)
  );
  const flowBoost = institutionalAlert.state === 'bombing' ? 25 : institutionalAlert.state === 'building' ? 10 : 0;
  const score = Math.max(0, Math.min(100, rawScore + flowBoost));

  const strength =
    score >= 85 ? 'extreme'
      : score >= 70 ? 'strong'
        : score >= 50 ? 'active'
          : score >= 30 ? 'lifting'
            : 'off';
  const light =
    ['strong', 'extreme'].includes(strength)
      ? 'green'
      : strength === 'active' || strength === 'lifting'
        ? 'yellow'
        : 'red';
  const ironBlocked = light === 'green' || ['strong', 'extreme'].includes(strength) || institutionalAlert.state === 'bombing';

  return {
    state: strength === 'off' ? 'inactive' : strength,
    light,
    score,
    strength,
    single_leg_permission: light === 'red' ? 'block' : 'wait',
    vertical_permission: light === 'yellow' || light === 'green' ? 'wait' : 'block',
    iron_condor_permission: ironBlocked ? 'block' : 'wait',
    plain_chinese:
      light === 'green'
        ? 'UW 波动强启动，禁止铁鹰，方向策略也必须等 TV。'
        : light === 'yellow'
          ? 'UW 波动升温，垂直结构优先观察。'
          : 'UW 波动未启动或偏低，单腿不放行。'
  };
}
