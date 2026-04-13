import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const concepts = await prisma.concept.findMany();
    const prerequisites = await prisma.prerequisite.findMany();

    // Map Prisma models to a clean representation for the frontend
    const nodes = (concepts || []).map((c) => ({
      id: c.id,
      gradeLevel: c.gradeLevel,
      topicCategory: c.topicCategory,
      nameVn: c.nameVn,
      description: c.description,
      masteryQuestion: c.masteryQuestion,
      misconceptions: c.misconceptions,
    }));

    const edges = (prerequisites || []).map((p) => ({
      id: p.id,
      source: p.sourceId,
      target: p.targetId,
      relationshipType: p.relationshipType,
    }));

    return NextResponse.json({ nodes, edges });
  } catch (error) {
    console.error('Error fetching graph data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch graph data', nodes: [], edges: [] },
      { status: 500 }
    );
  }
}
