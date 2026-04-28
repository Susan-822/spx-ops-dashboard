export function buildVolatilityLayer({ volatilityActivation = {} } = {}) {
  return {
    status: volatilityActivation.strength ? 'partial' : 'unavailable',
    iv_state: volatilityActivation.strength === 'extreme' ? 'panic' : volatilityActivation.strength === 'strong' ? 'elevated' : 'unknown',
    term_structure: 'unknown',
    volatility_activation: volatilityActivation.strength === 'off' ? 'inactive' : volatilityActivation.strength || 'inactive',
    single_leg_permission: ['active', 'strong', 'extreme'].includes(volatilityActivation.strength) ? 'allow' : 'wait',
    vertical_permission: volatilityActivation.strength === 'off' ? 'wait' : 'allow',
    iron_condor_permission: volatilityActivation.light === 'red' ? 'wait' : 'block',
    plain_chinese: volatilityActivation.plain_chinese || '波动未启动。'
  };
}
