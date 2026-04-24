function getTelegramConfig() {
  const enabled = String(process.env.TELEGRAM_ENABLED || '').toLowerCase() === 'true';
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_CHAT_ID || '';

  return {
    enabled,
    token,
    chatId,
    configured: enabled && Boolean(token && chatId)
  };
}

export async function getTelegramUpdates() {
  const config = getTelegramConfig();
  if (!config.token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
  }

  const response = await fetch(`https://api.telegram.org/bot${config.token}/getUpdates`);
  if (!response.ok) {
    throw new Error(`Telegram getUpdates failed: ${response.status}`);
  }

  return response.json();
}

export async function sendTelegramReal({ text }) {
  const config = getTelegramConfig();

  if (!config.configured) {
    return {
      source: 'telegram',
      configured: false,
      available: false,
      is_mock: false,
      message: config.enabled
        ? 'Telegram enabled, but token/chat id is missing.'
        : 'Telegram is not enabled.'
    };
  }

  const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chat_id: config.chatId,
      text
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Telegram sendMessage failed: ${response.status} ${errorBody}`);
  }

  const result = await response.json();

  return {
    source: 'telegram',
    configured: true,
    available: true,
    is_mock: false,
    message: 'Telegram test message sent.',
    result
  };
}

export function getTelegramStatus() {
  const config = getTelegramConfig();
  return {
    source: 'telegram',
    configured: config.configured,
    available: config.enabled,
    is_mock: false,
    message: config.configured
      ? 'Telegram is configured and ready.'
      : config.enabled
        ? 'Telegram is enabled, but token/chat id is incomplete.'
        : 'Telegram is not enabled.'
  };
}
