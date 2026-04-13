import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

/**
 * Parse the numbered misconceptions string into an array of individual bug texts.
 */
function parseMisconceptions(raw: string): string[] {
  return raw
    .split(/\d+\.\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main() {
  const url = process.env.DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  console.log('--- Environment Check ---');
  console.log('DATABASE_URL:', url ? 'PRESENT' : 'MISSING');
  
  if (!url) throw new Error('DATABASE_URL is missing');

  // Use config-based initialization directly
  const adapter = new PrismaLibSql({ url, authToken });
  const prisma = new PrismaClient({ adapter });

  console.log('Starting DB seed...');

  try {
    const dataDir = path.join(__dirname, '../data');
    const nodesFile = fs.existsSync(path.join(dataDir, 'nodes.csv')) ? path.join(dataDir, 'nodes.csv') : path.join(dataDir, 'nodes1.csv');
    const edgesFile = fs.existsSync(path.join(dataDir, 'edges.csv')) ? path.join(dataDir, 'edges.csv') : path.join(dataDir, 'edges1.csv');

    console.log('Reading concepts from:', nodesFile);
    const nodesRecords = parse(fs.readFileSync(nodesFile, 'utf8'), { columns: true, skip_empty_lines: true });
    
    console.log('Reading edges from:', edgesFile);
    const edgesRecords = parse(fs.readFileSync(edgesFile, 'utf8'), { columns: true, skip_empty_lines: true });

    console.log(`Parsed ${nodesRecords.length} concepts.`);

    // ── 2. Upsert Concepts ──────────────────────────────────────────────────────
    for (const record of nodesRecords) {
      await prisma.concept.upsert({
        where: { id: record.concept_code },
        update: {
          gradeLevel: parseInt(record.grade_level, 10),
          topicCategory: record.topic_category,
          nameVn: record.concept_name_vn,
          description: record.concept_description || '',
          masteryQuestion: record.mastery_question || '',
          misconceptions: record.common_misconceptions || '',
        },
        create: {
          id: record.concept_code,
          gradeLevel: parseInt(record.grade_level, 10),
          topicCategory: record.topic_category,
          nameVn: record.concept_name_vn,
          description: record.concept_description || '',
          masteryQuestion: record.mastery_question || '',
          misconceptions: record.common_misconceptions || '',
        },
      });
    }
    console.log('✓ Concepts upserted.');

    // ── 3. Upsert BugEntries ──────────────────────────────────────────────────
    let totalBugs = 0;
    for (const record of nodesRecords) {
      const conceptCode: string = record.concept_code;
      const bugTexts = parseMisconceptions(record.common_misconceptions || '');

      for (let i = 0; i < bugTexts.length; i++) {
        const bugIndex = i + 1;
        const bugId = `B-${conceptCode}-${String(bugIndex).padStart(2, '0')}`;

        await prisma.bugEntry.upsert({
          where: { id: bugId },
          update: {
            conceptId: conceptCode,
            bugIndex,
            description: bugTexts[i],
          },
          create: {
            id: bugId,
            conceptId: conceptCode,
            bugIndex,
            description: bugTexts[i],
          },
        });
        totalBugs++;
      }
    }
    console.log(`✓ BugEntries upserted: ${totalBugs} bugs.`);

    // ── 4. Upsert Prerequisites ────────────────────────────────────────────────
    console.log(`Parsed ${edgesRecords.length} edges.`);
    for (const record of edgesRecords) {
      const targetId = record.target_concept_code;
      const sourceId = record.source_concept_code;
      
      // Verify existence before linking
      const [targetExists, sourceExists] = await Promise.all([
        prisma.concept.findUnique({ where: { id: targetId }, select: { id: true } }),
        prisma.concept.findUnique({ where: { id: sourceId }, select: { id: true } }),
      ]);

      if (targetExists && sourceExists) {
        await prisma.prerequisite.upsert({
          where: { targetId_sourceId: { targetId, sourceId } },
          update: { relationshipType: record.relationship_type || 'HARD_PREREQUISITE' },
          create: { targetId, sourceId, relationshipType: record.relationship_type || 'HARD_PREREQUISITE' },
        });
      }
    }
    console.log('✓ Prerequisites upserted.');
    console.log('\n🎉 Seeding complete!');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
