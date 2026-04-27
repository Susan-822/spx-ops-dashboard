export function runFlowValidationEngine({
  institutionalAlert = {},
  darkpoolSummary = {},
  marketSentiment = {},
  dealerEngine = {},
  technicalEngine = {}
} = {}) {
  const directional = [
    institutionalAlert.direction,
    darkpoolSummary.bias === 'support' ? 'bullish' : darkpoolSummary.bias === 'resistance' ? 'bearish' : 'neutral',
    marketSentiment.state === 'risk_on' ? 'bullish' : marketSentiment.state === 'risk_off' ? 'bearish' : 'neutral'
  ];
  const bullish = directional.filter((item) => item === 'bullish').length;
  const bearish = directional.filter((item) => item === 'bearish').length;
  const conflict = bullish > 0 && bearish > 0;
  const alignment =
    conflict ? 'conflict'
      : bullish >= 2 ? 'bullish'
        : bearish >= 2 ? 'bearish'
          : 'mixed';
  const dealerPath = dealerEngine.path_of_least_resistance;
  const dealerAligned = alignment === 'mixed' || dealerPath === 'unknown' || dealerPath === 'range'
    ? false
    : (alignment === 'bullish' && dealerPath === 'up') || (alignment === 'bearish' && dealerPath === 'down');
  const absorption = technicalEngine.volume_pressure === 'high' && technicalEngine.trend_bias === 'neutral';
  const confidence_delta = conflict ? -20 : dealerAligned ? 20 : bullish >= 2 || bearish >= 2 ? 10 : 0;
  return {
    alignment,
    confidence_delta,
    conflict,
    absorption,
    action: conflict || absorption ? 'wait' : 'confirm',
    plain_chinese:
      conflict
        ? 'Flow / Dark Pool / Market Tide 三者冲突，等待。'
        : absorption
          ? '量能高但价格不延续，疑似 absorption，禁止追单。'
          : dealerAligned
            ? 'Flow / Dark Pool / Tide 与 Dealer path 同向，置信度加分。'
            : 'Flow 方向未形成强一致，只作为辅助。'
  };
}
