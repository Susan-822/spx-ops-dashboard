export function runTechnicalEngine({ technicalFactors = {}, provider = {} } = {}) {
  if (!['live', 'partial', 'stale'].includes(provider.status)) {
    return {
      trend_bias: 'unknown',
      channel_shape: 'unknown',
      volume_pressure: 'unknown',
      plain_chinese: '技术/通道数据不可用。'
    };
  }

  return {
    trend_bias: technicalFactors.trend_bias || 'unknown',
    channel_shape: technicalFactors.channel_shape || 'unknown',
    volume_pressure: technicalFactors.volume_pressure || 'unknown',
    plain_chinese: `技术面 ${technicalFactors.trend_bias || 'unknown'}，通道 ${technicalFactors.channel_shape || 'unknown'}，量压 ${technicalFactors.volume_pressure || 'unknown'}。`
  };
}
