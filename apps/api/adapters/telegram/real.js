export async function sendTelegramReal() {
  const configured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  return {
    source: 'telegram',
    configured,
    available: false,
    is_mock: false,
    message: configured
      ? 'Real Telegram adapter skeleton is present but outbound alerts are disabled.'
      : 'Telegram is not configured.'
  };
}
