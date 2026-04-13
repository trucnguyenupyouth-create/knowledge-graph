import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const historyList = await prisma.diagnosticHistory.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50, // Limit to recent 50
    });
    
    return NextResponse.json({ data: historyList });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Lỗi fetch history: ${err.message ?? 'Unknown'}` },
      { status: 500 }
    );
  }
}
