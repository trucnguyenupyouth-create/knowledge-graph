import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { GoogleGenAI } from '@google/genai';
import { getGeminiClient } from '@/lib/gemini';

// ─── Types ──────────────────────────────────────────────────────────────────

interface DiagnoseRequest {
  problem: string;
  studentAnswer: string;
  targetConceptCode?: string; // Optional — if the teacher already knows the topic
  gradingResult?: any; // Output from /api/grade
}

interface BugMatch {
  matches: Array<{
    matched_bug_id: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    severity: 'CONCEPTUAL_GAP' | 'EXECUTION_SLIP';
  }>;
  explanation: string; // Vietnamese pedagogical explanation
}

// ─── Recursive CTE via Prisma $queryRaw ─────────────────────────────────────

async function getAncestorConceptIds(targetConceptId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ conceptId: string }[]>`
    WITH RECURSIVE ancestor_tree AS (
      SELECT sourceId AS conceptId, 1 AS depth
      FROM Prerequisite
      WHERE targetId = ${targetConceptId}

      UNION

      SELECT p.sourceId, at.depth + 1
      FROM Prerequisite p
      JOIN ancestor_tree at ON p.targetId = at.conceptId
    )
    SELECT conceptId FROM ancestor_tree
    UNION SELECT ${targetConceptId} AS conceptId
  `;
  return rows.map((r) => r.conceptId);
}

// ─── Stage 0: Topic Classification (when no targetConceptCode given) ─────────

async function classifyTopic(problem: string, ai: GoogleGenAI): Promise<string | null> {
  const prompt = `You are a Vietnamese math curriculum expert.
Classify the following math problem into ONE of these topic prefixes:
- RAD: Căn Bậc Hai (G9)
- LIN: Hàm Số Bậc Nhất (G9)
- QDR: Phương Trình Bậc Hai (G9)
- GEO: Hình Học (G9)
- UNK: Unknown/Other

PROBLEM:
${problem}

Return ONLY the 3-letter prefix string.`;

  try {
    const result = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    const prefix = result.text?.trim().toUpperCase() || 'UNK';
    if (['RAD', 'LIN', 'QDR', 'GEO'].includes(prefix)) {
      return prefix;
    }
    return null;
  } catch (error) {
    console.error('Classification error:', error);
    return null; // degrade gracefully
  }
}

// ─── Pipeline Helper ─────────────────────────────────────────────────────────

async function matchBugWithGemini(
  problem: string,
  studentAnswer: string,
  candidateBugs: any[],
  ai: GoogleGenAI
): Promise<BugMatch> {
  const bugListStr = candidateBugs
    .map(
      (b) => `ID: ${b.id}\nConcept ID: ${b.conceptId}\nLỗi sai: ${b.description}`
    )
    .join('\n\n');

  const prompt = `Bạn là hệ thống CDM (Cognitive Diagnostic Model) chẩn đoán lỗi sai của học sinh môn Toán.

ĐỀ BÀI:
${problem}

MÔ TẢ CÁC LỖI TỪ GIÁO VIÊN (HOẶC HỌC SINH TỰ NHẬP):
${studentAnswer}

Dưới đây là danh sách CÁC LỖI SAI PHỔ BIẾN (Bug Library) có thể là nguyên nhân:
${bugListStr || '(Không có lỗi mẫu nào trong library để force - Bạn phải trả về matches: [])'}

NHIỆM VỤ:
Dựa vào Mô tả ở trên, hãy xác định TẤT CẢ các lỗi sai (knowledge gaps) mà học sinh mắc phải bằng cách đối chiếu với [Bug Library]. 

OUTPUT ĐỊNH DẠNG JSON NGHIÊM NGẶT:
{
  "matches": [
    {
       "matched_bug_id": "<Mã ID của lỗi sai khớp KHÍCH nhất trong danh sách. Bắt buộc phải là 1 ID trong danh sách trên>",
       "confidence": "HIGH" | "MEDIUM" | "LOW",
       "severity": "CONCEPTUAL_GAP" | "EXECUTION_SLIP"
    }
  ],
  "explanation": "<Nhận xét sư phạm DÀNH CHO GIÁO VIÊN về (các) lỗi sai tìm được của học sinh>"
}

LƯU Ý: Nếu bài làm không hề vi phạm (khớp) bất kì lỗi nào trong danh sách Bug Library, hãy trả về mảng "matches" rỗng ([]), KHÔNG tự bịa ra ID mới.`;

  const result = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });

  const parsed = JSON.parse(result.text || '{"matches": [], "explanation": ""}');
  if (!parsed.matches) {
     parsed.matches = [];
  }
  return parsed as BugMatch;
}

// ─── Main Pipeline Handler ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body: DiagnoseRequest = await req.json();
    const { problem, studentAnswer, targetConceptCode, gradingResult } = body;

    // Gộp TẤT CẢ các critical errors vào Input Context
    let diagnosticInputContext = studentAnswer;
    if (gradingResult && gradingResult.steps && Array.isArray(gradingResult.steps)) {
      const targetErrors = gradingResult.steps.filter((s: any) => 
        s.is_correct === false && s.error_type === "critical"
      );
      
      if (targetErrors.length > 0) {
        diagnosticInputContext = "Tổng hợp các lỗi nghiêm trọng (Critical Gaps):\n" + targetErrors.map((error: any) => 
          `[Bước ${error.step_number}]: ${error.description}\n` +
          `- Học sinh viết: ${error.student_work}\n` +
          `- Đúng ra phải là: ${error.correct_answer}\n` +
          `- Feedback giáo viên: ${error.feedback}`
        ).join("\n\n");
      }
    }

    if (!problem?.trim() || (!studentAnswer?.trim() && !diagnosticInputContext)) {
      return NextResponse.json(
        { error: 'problem và studentAnswer là bắt buộc.' },
        { status: 400 }
      );
    }

    const ai = getGeminiClient();

    // ── Stage 1: Graph Pre-filtering ─────────────────────────────────────────
    let candidateBugs: any[] = [];
    let effectiveTargetNodeId: string | undefined | null = targetConceptCode;

    if (!effectiveTargetNodeId) {
      const prefix = await classifyTopic(problem, ai);
      if (prefix && prefix !== 'UNK') {
        const potentialConcepts = await prisma.concept.findMany({
          where: { id: { startsWith: prefix } },
          select: { id: true, nameVn: true },
        });

        const prompt = `Từ danh sách concept: ${JSON.stringify(potentialConcepts)}, chọn ID duy nhất phù hợp nhất với bài toán:\n${problem}\nNếu không chắc, trả về UNKNOWN_CODE. Trả về đúng mã ID, không thêm gì cả.`;
        const result = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: prompt,
        });
        effectiveTargetNodeId = result.text?.trim() || undefined;
      }
    }

    if (effectiveTargetNodeId && effectiveTargetNodeId !== 'UNKNOWN_CODE') {
      const ancestorIds = await getAncestorConceptIds(effectiveTargetNodeId);
      candidateBugs = await prisma.bugEntry.findMany({
        where: { conceptId: { in: ancestorIds } },
        include: { concept: true },
      });
    } else {
      candidateBugs = await prisma.bugEntry.findMany({
        include: { concept: true },
      });
    }

    // ── Stage 2: LLM Bug Matching (Multi-Gaps) ───────────────────────────────
    const bugMatch = await matchBugWithGemini(problem, diagnosticInputContext, candidateBugs, ai);

    // ── Stage 3: Deterministic DB Lookup (For Each Match) ────────────────────
    
    // Using Maps to deduplicate responses
    const rootNodesMap = new Map();
    const prerequisiteChainsMap = new Map();
    const matchedBugIds: string[] = [];
    const matchedRootConceptIds: string[] = [];

    for (const match of bugMatch.matches) {
       if (match.matched_bug_id) {
           matchedBugIds.push(match.matched_bug_id);
           // Lấy Concept liên quan DB
           const bugDbEntry = await prisma.bugEntry.findUnique({
              where: { id: match.matched_bug_id },
              include: { concept: true }
           });

           if (bugDbEntry?.concept) {
              matchedRootConceptIds.push(bugDbEntry.concept.id);
              rootNodesMap.set(bugDbEntry.concept.id, {
                 id: bugDbEntry.concept.id,
                 nameVn: bugDbEntry.concept.nameVn,
                 gradeLevel: bugDbEntry.concept.gradeLevel,
                 topicCategory: bugDbEntry.concept.topicCategory,
                 description: bugDbEntry.concept.description,
                 masteryQuestion: bugDbEntry.concept.masteryQuestion,
                 matchedBug: match // Attaching the specific match detail
              });

              // Tracing Path for this concept (chỉ lấy tổ tiên trực tiếp)
              const ancestors = await getAncestorConceptIds(bugDbEntry.concept.id);
              if (ancestors.length > 1) { // 1 là chính nó
                const concepts = await prisma.concept.findMany({
                  where: { id: { in: ancestors } }
                });
                
                concepts.forEach((c) => {
                  if (c.id !== bugDbEntry.concept.id) {
                     prerequisiteChainsMap.set(c.id, {
                        depth: 1, // simplified depth mapping
                        id: c.id,
                        nameVn: c.nameVn,
                        gradeLevel: c.gradeLevel,
                        masteryQuestion: c.masteryQuestion
                     });
                  }
                });
              }
           }
       }
    }

    // ── Stage 4: Save History to DB ──────────────────────────────────────────
    // Serialize to JSON string if we have arrays
    const finalBugIdsJson = matchedBugIds.length > 0 ? JSON.stringify(matchedBugIds) : null;
    const finalConceptIdsJson = matchedRootConceptIds.length > 0 ? JSON.stringify(matchedRootConceptIds) : null;

    // Use overall confidence/severity base on worst case logic, or default to mapping
    let overallConfidence = "LOW";
    if (bugMatch.matches.some(m => m.confidence === "HIGH")) overallConfidence = "HIGH";
    else if (bugMatch.matches.some(m => m.confidence === "MEDIUM")) overallConfidence = "MEDIUM";

    let overallSeverity = "EXECUTION_SLIP";
    if (bugMatch.matches.some(m => m.severity === "CONCEPTUAL_GAP")) overallSeverity = "CONCEPTUAL_GAP";

    const responsePayload = {
      matches: Array.from(rootNodesMap.values()),
      prerequisite_chain: Array.from(prerequisiteChainsMap.values()),
      explanation: bugMatch.explanation,
      meta: {
        candidate_concept_count: candidateBugs.reduce((acc, bug) => acc.add(bug.conceptId), new Set()).size,
        candidate_bug_count: candidateBugs.length,
        topic_prefix: effectiveTargetNodeId ? effectiveTargetNodeId.substring(0, 3) : null,
        target_concept_code: effectiveTargetNodeId,
      },
    };

    const historyRecord = await prisma.diagnosticHistory.create({
      data: {
        problem,
        studentAnswer,
        targetConceptCode: targetConceptCode ?? null,
        gradingResult: gradingResult ? JSON.stringify(gradingResult) : null,
        totalScore: gradingResult?.score ?? null,
        maxScore: gradingResult?.max_score ?? 1.0,
        matchedBugIds: finalBugIdsJson,
        rootConceptIds: finalConceptIdsJson,
        confidence: overallConfidence,
        severity: overallSeverity,
        explanation: bugMatch.explanation ?? '',
        diagnosticRaw: JSON.stringify(responsePayload),
      },
    });

    return NextResponse.json({ ...responsePayload, history_id: historyRecord.id });
  } catch (err: any) {
    console.error('[/api/diagnose] Error:', err);
    return NextResponse.json(
      { error: `Lỗi xử lý: ${err.message}` },
      { status: 500 }
    );
  }
}
