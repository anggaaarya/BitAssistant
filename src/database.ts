import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export async function getUserRole(telegramId: number): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { telegramId } });
  return user?.role || null;
}

export async function isUserRegistered(telegramId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { telegramId } });
  return user?.isRegistered || false;
}

export async function isAdmin(telegramId: number): Promise<boolean> {
  const role = await getUserRole(telegramId);
  return role === 'ADMIN';
}

export async function isAdminOrSO(telegramId: number): Promise<boolean> {
  const role = await getUserRole(telegramId);
  return role === 'ADMIN' || role === 'SOAREA';
}