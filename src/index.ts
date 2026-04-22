import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import { registerCommands } from './handlers/command';
import { registerCallbacks } from './handlers/callback';
import { handleTextMessage } from './handlers/message';

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('BOT_TOKEN tidak ditemukan');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Register all handlers
registerCommands(bot);
registerCallbacks(bot);
bot.on('text', handleTextMessage);

// Launch
if (process.env.NODE_ENV !== 'production') {
  bot.launch().then(() => console.log('Bot running locally...'));
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

export default async (req: any, res: any) => {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body, res);
      res.status(200).end();
    } catch (error) {
      console.error(error);
      res.status(500).end();
    }
  } else {
    res.status(200).send('Bit Assistant Bot is running!');
  }
};