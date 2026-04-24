export async function sendTelegramMock() {
  return {
    source: 'telegram',
    configured: false,
    available: true,
    is_mock: true,
    message: 'Mock Telegram fallback payload.'
  };
}
