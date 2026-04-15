import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('Test function called');
  res.status(200).json({ status: 'ok', message: 'Bot is alive!' });
}