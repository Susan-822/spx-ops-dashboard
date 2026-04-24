const bootTime = new Date().toISOString();

export function getRecentLogs() {
  return [
    {
      id: 'log-boot',
      level: 'info',
      message: 'API skeleton booted with mock-safe fallbacks.',
      is_mock: true,
      created_at: bootTime
    }
  ];
}
