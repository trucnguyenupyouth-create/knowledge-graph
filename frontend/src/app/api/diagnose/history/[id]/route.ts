import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { expertNotes } = body;

    if (!id || typeof expertNotes !== 'string') {
      return NextResponse.json({ error: 'Thiếu id hoặc expertNotes không hợp lệ.' }, { status: 400 });
    }

    const updatedRecord = await prisma.diagnosticHistory.update({
      where: { id },
      data: { expertNotes }
    });

    return NextResponse.json({ success: true, expertNotes: updatedRecord.expertNotes });
  } catch (error) {
    console.error('[/api/diagnose/history/[id]] Error updating expert notes:', error);
    return NextResponse.json(
      { error: 'Không thể cập nhật ghi chú chuyên gia' },
      { status: 500 }
    );
  }
}
