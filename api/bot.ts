import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN tidak ditemukan di .env');
}

const prisma = new PrismaClient();
const bot = new Telegraf(BOT_TOKEN || '');

// ==================== SEMUA FUNGSI BOT ====================
// (salin SEMUA fungsi dari file index.ts kamu di sini)
// mulai dari registrationSession, isPrivateChat, isGroupChat,
// getUserRole, isUserRegistered, isAdminOrSO, isAdmin,
// generateOrderNumber, parseRequestMessage, buildOrderMessage,
// sendOrEditOrderMessage, startRegistration, completeRegistration,
// showRoleSelection, showAdminMenu, showUserManagementMenu,
// showStatusOrbit, showAllUsers, resetUserRole, deleteUser, editUserRole,
// adminSession, semua bot.action, semua bot.command, bot.on('text')
// 
// TAPI JANGAN COPY bagian "bot.launch()" dan "process.once"
// ==================== SAMPAI SINI ====================

// ==================== EKSPOR UNTUK VERCEL (WEBHOOK) ====================
// HAPUS atau KOMENTARI bot.launch() jika ada
// Tambahkan ini di akhir file:

export default async (req: any, res: any) => {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body, res);
      res.status(200).end();
    } catch (error) {
      console.error('Error handling update:', error);
      res.status(500).end();
    }
  } else {
    res.status(200).send('Bit Assistant Bot is running!');
  }
};