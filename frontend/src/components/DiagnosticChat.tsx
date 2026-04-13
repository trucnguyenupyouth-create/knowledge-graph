"use client";

import React, { useState, useEffect } from "react";
import {
  BrainCircuit, X, Send, Loader2, AlertOctagon,
  BookOpen, ChevronRight, CheckCircle2, Microscope,
  AlertTriangle, ArrowRight, History, PlaySquare, Plus,
  ListChecks, CheckCircle, Save
} from "lucide-react";
import clsx from "clsx";

export interface GradingStep {
  step_number: number;
  description: string;
  student_work: string;
  correct_answer: string;
  is_unattempted: boolean;
  is_correct: boolean;
  error_type: "critical" | "minor" | "cascading" | null;
  caused_by_step: number | null;
  feedback: string;
}

export interface GradingResult {
  question_id: number;
  is_unattempted: boolean;
  is_correct: boolean;
  partial_credit: boolean;
  score: number;
  goal_text: string;
  steps: GradingStep[];
  overall_feedback: string;
  max_score?: number;
}

interface DiagnosticResult {
  matches: Array<{
    id: string;
    nameVn: string;
    gradeLevel: number;
    topicCategory: string;
    description: string;
    masteryQuestion: string;
    matchedBug: {
       matched_bug_id: string;
       confidence: "HIGH" | "MEDIUM" | "LOW";
       severity: "CONCEPTUAL_GAP" | "EXECUTION_SLIP";
    }
  }>;
  prerequisite_chain: Array<{
    depth: number;
    id: string;
    nameVn: string;
    gradeLevel: number;
    masteryQuestion: string;
  }>;
  explanation: string;
  meta: {
    candidate_concept_count: number;
    candidate_bug_count: number;
    topic_prefix: string | null;
    target_concept_code: string | null;
  };
  history_id?: string;
}

interface HistoryRecord {
  id: string;
  createdAt: string;
  problem: string;
  studentAnswer: string;
  gradingResult?: string;
  diagnosticRaw?: string;
  expertNotes?: string;
  totalScore?: number;
  maxScore?: number;
  matchedBugIds: string | null;
  rootConceptIds: string | null;
  confidence: string;
  severity: string;
  explanation: string;
}

interface Props {
  onClose: () => void;
  onNodeHighlight: (conceptIds: string[]) => void;
  availableConcepts: Array<{ id: string; nameVn: string; gradeLevel: number }>;
}

const confidenceColor: Record<string, string> = {
  HIGH: "bg-emerald-100 text-emerald-800 border-emerald-200",
  MEDIUM: "bg-amber-100 text-amber-800 border-amber-200",
  LOW: "bg-rose-100 text-rose-800 border-rose-200",
};

const severityConfig: Record<string, {label: string, color: string, icon: React.ReactNode}> = {
  CONCEPTUAL_GAP: {
    label: "Lỗ hổng Khái niệm",
    color: "bg-rose-50 border-rose-300 text-rose-800",
    icon: <BrainCircuit size={14} />,
  },
  EXECUTION_SLIP: {
    label: "Lỗi Tính toán",
    color: "bg-amber-50 border-amber-300 text-amber-800",
    icon: <AlertTriangle size={14} />,
  },
  UNKNOWN: {
    label: "Không xác định",
    color: "bg-slate-50 border-slate-300 text-slate-800",
    icon: <AlertOctagon size={14} />,
  }
};

const gradingErrorConfig: Record<string, { color: string }> = {
  critical: { color: "bg-rose-500/20 text-rose-400 border-rose-500/30" },
  minor: { color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  cascading: { color: "bg-orange-500/20 text-orange-400 border-orange-500/30" }
};

const renderScoreBadge = (score?: number | null, maxScore: number = 1.0) => {
  if (score === undefined || score === null) return null;
  const ratio = score / maxScore;
  const color = ratio === 1 ? "bg-emerald-500 text-emerald-100" 
        : ratio >= 0.5 ? "bg-amber-500 text-amber-100" 
        : "bg-rose-500 text-rose-100";
  return (
    <span className={clsx("text-[10px] font-black px-2 py-0.5 rounded shadow-sm", color)}>
      {score}/{maxScore} ĐIỂM
    </span>
  );
};

// ====================================================================================
// SUB-COMPONENT: Reusable Feedback Viewer (Shared for both NEW tab and HISTORY tab)
// ====================================================================================
function DiagnosticResultViewer({
  gradingData,
  result,
  onNodeHighlight,
  historyId,
  initialExpertNotes = "",
}: {
  gradingData?: GradingResult | null;
  result?: DiagnosticResult | null;
  onNodeHighlight: (conceptIds: string[]) => void;
  historyId?: string;
  initialExpertNotes?: string;
}) {
  const [showGradingDetail, setShowGradingDetail] = useState(false);
  const [expertNote, setExpertNote] = useState(initialExpertNotes);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  // Sync internal state if initialExpertNotes changes dynamically
  useEffect(() => {
    setExpertNote(initialExpertNotes);
  }, [initialExpertNotes]);

  async function handleSaveNote() {
    if (!historyId) return;
    setIsSavingNote(true);
    setNoteSaved(false);
    try {
      const res = await fetch(`/api/diagnose/history/${historyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expertNotes: expertNote })
      });
      if (res.ok) {
        setNoteSaved(true);
        setTimeout(() => setNoteSaved(false), 2500);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingNote(false);
    }
  }

  return (
    <div className="space-y-6 pt-2 pb-6">
      {/* ── GRADING SECTION ── */}
      {gradingData && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 gap-y-3 flex flex-col">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-[10px] font-black text-amber-400">1</div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Stage 1: AI Grading</span>
            </div>
            {renderScoreBadge(gradingData.score, 1.0)}
          </div>

          <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl overflow-hidden shadow-sm hover:border-slate-600/50 transition-all">
            <button 
              onClick={() => setShowGradingDetail(!showGradingDetail)}
              className="w-full flex justify-between items-center p-4 bg-slate-800/60"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} className={gradingData.is_correct ? "text-emerald-400" : "text-rose-400"} />
                <span className="text-[12px] font-bold text-slate-200">
                  {gradingData.is_correct ? "Bài làm đúng hoàn toàn" : `Phát hiện lỗi sai`}
                </span>
              </div>
              <ChevronRight size={16} className={clsx("text-slate-500 transition-transform", showGradingDetail && "rotate-90")} />
            </button>
            
            {showGradingDetail && (
              <div className="p-4 border-t border-white/5 space-y-3">
                <p className="text-[12px] text-slate-300 bg-slate-900/50 p-3 rounded-lg border border-white/5 italic">
                  "{gradingData.overall_feedback}"
                </p>
                <div className="space-y-2 mt-3">
                  {gradingData.steps.map((step, idx) => (
                    <div key={idx} className="flex flex-col gap-1.5 p-3 rounded-lg bg-slate-900/30 border border-white/5">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Step {step.step_number}: {step.description}</span>
                      <div className="flex justify-between items-start">
                         <code className={clsx("text-[11px] font-mono", step.is_correct ? "text-emerald-300" : "text-rose-300 line-through")}>{step.student_work}</code>
                         {!step.is_correct && step.error_type && (
                           <span className={clsx("text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase", gradingErrorConfig[step.error_type]?.color)}>
                             {step.error_type}
                           </span>
                         )}
                      </div>
                      {!step.is_correct && (
                        <>
                          <p className="text-[11px] text-emerald-400/80 mt-1">Đúng: {step.correct_answer}</p>
                          <p className="text-[11px] text-rose-300/80">Lỗi: {step.feedback}</p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── DIAGNOSIS SECTION ── */}
      {result && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 delay-75 fill-mode-both">
          <div className="flex items-center space-x-2 mb-3 mt-4">
            <div className="w-5 h-5 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-[10px] font-black text-indigo-400">2</div>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Stage 2: Knowledge Gaps (CDM)</span>
          </div>
          
          {result.matches && result.matches.length > 0 ? (
            <>
              {/* AI Explanation / Summary */}
              <div className="mb-4">
                <div className="flex items-center space-x-2 mb-2">
                  <BookOpen size={14} className="text-slate-500" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Phân tích Sư phạm (CDM)</span>
                </div>
                <p className="text-slate-300 text-[13px] leading-relaxed bg-slate-800/40 border border-white/5 rounded-xl p-4 shadow-inner">
                  {result.explanation}
                </p>
              </div>

              <div className="flex items-center justify-between mt-6 mb-3">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                   Phát hiện {result.matches.length} Lỗ hổng
                </span>
                <button
                    onClick={() => onNodeHighlight(result.matches.map((m: any) => m.id))}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold uppercase tracking-widest flex items-center gap-1.5 transition-colors bg-indigo-500/10 px-3 py-1.5 rounded-lg border border-indigo-500/20"
                  >
                    <PlaySquare size={12} /> Focus Tất cả Nodes
                </button>
              </div>

              <div className="space-y-3">
                {/* DB Resolution for EACH Match */}
                {result.matches.map((matchData: any, idx: number) => (
                  <button
                    key={matchData.id}
                    onClick={() => onNodeHighlight([matchData.id])} // Focus single node upon click
                    className="w-full text-left bg-rose-950/30 border border-rose-900/50 hover:bg-rose-900/40 hover:border-rose-500/50 rounded-xl p-4 transition-all group overflow-hidden relative block"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <code className="text-rose-400 font-mono text-[11px] font-bold bg-rose-500/10 px-2 py-0.5 rounded">
                        {matchData.matchedBug.matched_bug_id} → {matchData.id}
                      </code>
                      <span className={clsx("text-[9px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider", confidenceColor[matchData.matchedBug.confidence])}>
                        {matchData.matchedBug.confidence}
                      </span>
                    </div>
                    <p className="text-slate-100 font-bold text-[13px] leading-tight mb-2">
                      {matchData.nameVn}
                    </p>
                    <div className={clsx("flex items-center gap-1.5 text-[9px] font-bold px-2 py-1.5 rounded-lg border w-fit", severityConfig[matchData.matchedBug.severity]?.color)}>
                       {severityConfig[matchData.matchedBug.severity]?.icon}
                       <span className="uppercase tracking-wider">{severityConfig[matchData.matchedBug.severity]?.label}</span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Remediation */}
              {result.prerequisite_chain.length > 0 && (
                <div className="mt-6">
                  <div className="flex items-center space-x-2 mb-2.5">
                    <div className="w-5 h-5 rounded-full bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-[10px] font-black text-emerald-400">3</div>
                    <span className="text-[10px] font-black text-emerald-400/80 uppercase tracking-widest">Remediation Path (Tổ hợp {result.prerequisite_chain.length} Concepts)</span>
                  </div>
                  <div className="space-y-2">
                    {result.prerequisite_chain.slice(0, 5).map((node: any, idx: number) => (
                      <button
                        key={node.id}
                        onClick={() => onNodeHighlight([node.id])}
                        className="w-full text-left flex items-center space-x-3 bg-slate-800/30 hover:bg-slate-700/50 border border-white/5 rounded-xl px-4 py-3 transition-all group"
                      >
                        <span className="w-5 h-5 rounded-full bg-slate-900 border border-slate-700 text-slate-400 flex-shrink-0 flex items-center justify-center text-[9px] font-black">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-slate-300 text-[12px] font-semibold truncate group-hover:text-white transition-colors">{node.nameVn}</p>
                        </div>
                        <span className="text-[10px] font-black text-slate-600 group-hover:text-emerald-400/80">G{node.gradeLevel}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center text-center py-8 px-6 border border-dashed border-slate-700/50 rounded-2xl bg-slate-800/20">
              <CheckCircle size={24} className="text-slate-500 mb-2" />
              <p className="text-slate-300 text-[12px] font-medium">
                Không có lỗi nào đủ mức "critical" để match vào Knowledge Graph.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── EXPERT NOTES BOX (HITL) ── */}
      {historyId && (
        <div className="mt-8 pt-6 border-t border-slate-700/50 bg-slate-800/10 rounded-b-xl animate-in fade-in duration-500 delay-150">
          <div className="flex items-center space-x-2 mb-3">
            <div className="w-5 h-5 rounded bg-slate-700 border border-slate-600 flex items-center justify-center text-[10px] font-black text-slate-300 shadow-inner">
               i
            </div>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sổ Tay Chuyên Gia (HitL Audit)</span>
          </div>
          <textarea 
             value={expertNote} 
             onChange={(e) => setExpertNote(e.target.value)}
             rows={3}
             placeholder="Nhập đánh giá của chuyên gia sư phạm về ca chẩn đoán này (Lưu ý, đánh giá thiếu case, kiến nghị rule bắt lỗi...)"
             className="w-full bg-slate-900/60 border border-slate-700/60 text-slate-200 placeholder-slate-600 rounded-xl px-4 py-3 text-[12px] resize-none focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-all shadow-inner" 
          />
          <div className="flex justify-end mt-2.5">
            <button 
               onClick={handleSaveNote} 
               disabled={isSavingNote}
               className={clsx(
                 "flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold transition-all shadow-sm",
                 noteSaved 
                   ? "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30" 
                   : "bg-slate-700 text-slate-200 hover:bg-slate-600 border border-slate-600"
               )}
            >
              <Save size={13} />
              {isSavingNote ? "Đang lưu..." : noteSaved ? "Đã lưu nhận xét ✓" : "Lưu Ghi Chú"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ====================================================================================
// MAIN COMPONENT
// ====================================================================================
export default function DiagnosticChat({ onClose, onNodeHighlight, availableConcepts }: Props) {
  const [activeTab, setActiveTab] = useState<"NEW" | "HISTORY">("NEW");
  
  // States cho New Diagnostic Pipeline
  const [problem, setProblem] = useState("");
  const [studentAnswer, setStudentAnswer] = useState("");
  const [targetCode, setTargetCode] = useState("");
  
  const [isGrading, setIsGrading] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [gradingData, setGradingData] = useState<GradingResult | null>(null);
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // States cho History
  const [histories, setHistories] = useState<HistoryRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === "HISTORY") {
      fetchHistory();
    }
  }, [activeTab]);

  // ── IN-MEMORY CACHE RESET (Invalidation) ──
  useEffect(() => {
    // If user modifies input texts, invalidate cached grading data
    setGradingData(null);
    setResult(null);
    setError(null);
  }, [problem, studentAnswer]);

  async function fetchHistory() {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/diagnose/history");
      const data = await res.json();
      if (res.ok) {
        setHistories(data.data);
      }
    } catch (err) {
      console.error("Lỗi fetch history:", err);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function handlePipelineSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!problem.trim() || !studentAnswer.trim()) return;

    setResult(null);
    setError(null);

    let currentGradingRes = gradingData;

    // ── STAGE 1: AI GRADING (Skip if Cached) ──
    if (!currentGradingRes) {
      setIsGrading(true);
      try {
        const gradeRes = await fetch("/api/grade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ problem, studentAnswer }),
        });
        const data = await gradeRes.json();
        if (!gradeRes.ok) throw new Error(data.error ?? "Lỗi chấm bài");
        currentGradingRes = data;
        setGradingData(data);
      } catch (err: any) {
        setError(`[Stage 1 Error] ${err.message}`);
        setIsGrading(false);
        return;
      }
      setIsGrading(false);
    }

    if (!currentGradingRes) return; // Halt if stage 1 failed

    // ── STAGE 2: AI DIAGNOSIS ──
    setIsDiagnosing(true);
    try {
      const diagnoseRes = await fetch("/api/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problem,
          studentAnswer,
          targetConceptCode: targetCode || undefined,
          gradingResult: currentGradingRes,
        }),
      });

      const data = await diagnoseRes.json();
      if (!diagnoseRes.ok) throw new Error(data.error ?? "Lỗi chẩn đoán");

      setResult(data); // `data` includes history_id now
      if (data.matches && data.matches.length > 0) {
        onNodeHighlight(data.matches.map((m: any) => m.id));
      } else {
        onNodeHighlight([]); // clear highlight if no match
      }
    } catch (err: any) {
      setError(`[Stage 2 Error] ${err.message}`);
    } finally {
      setIsDiagnosing(false);
    }
  }

  return (
    <div className="fixed top-0 right-0 w-[480px] h-full bg-slate-900/95 backdrop-blur-3xl border-l border-white/5 shadow-2xl z-50 flex flex-col overflow-hidden transition-all duration-300">
      
      {/* HEADER SECTION */}
      <div className="px-6 pt-5 pb-0 border-b border-white/5 bg-slate-800/20">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-indigo-500/20 border border-indigo-500/30 rounded-xl shadow-[0_0_15px_rgba(99,102,241,0.15)] flex items-center justify-center">
              <Microscope size={18} className="text-indigo-400" />
            </div>
            <div>
              <h2 className="text-[15px] font-black text-slate-100 tracking-tight">AI Pipeline (Multi-Gaps)</h2>
              <p className="text-[11px] text-slate-400 font-medium">Head Teacher Grading → CDM Diagnosis</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-200 hover:bg-slate-700/50 rounded-lg transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* TAB NAVIGATION */}
        <div className="flex space-x-1">
          <button
            onClick={() => setActiveTab("NEW")}
            className={clsx(
              "px-4 py-2.5 text-[12px] font-bold rounded-t-xl transition-all flex items-center gap-2",
              activeTab === "NEW" 
                ? "bg-slate-800/80 text-white border-t border-l border-r border-white/10" 
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/40"
            )}
          >
            <Plus size={14} /> Pipeline Mới
          </button>
          <button
            onClick={() => setActiveTab("HISTORY")}
            className={clsx(
              "px-4 py-2.5 text-[12px] font-bold rounded-t-xl transition-all flex items-center gap-2",
              activeTab === "HISTORY" 
                ? "bg-slate-800/80 text-white border-t border-l border-r border-white/10" 
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/40"
            )}
          >
            <History size={14} /> Lịch sử
          </button>
        </div>
      </div>

      {/* CONTENT AREA */}
      <div className="flex-1 overflow-y-auto bg-slate-900/50">
        
        {/* ============================================================== */}
        {/* NEW DIAGNOSTIC TAB */}
        {/* ============================================================== */}
        {activeTab === "NEW" && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Input Form */}
            <form onSubmit={handlePipelineSubmit} className="p-6 space-y-4 border-b border-white/5 bg-slate-800/20">
              <div>
                <label className="block text-[10px] font-black text-indigo-400/80 uppercase tracking-widest mb-2">
                  Đề bài
                </label>
                <textarea
                  value={problem}
                  onChange={(e) => setProblem(e.target.value)}
                  rows={2}
                  placeholder="Nhập đề bài toán... VD: Giải phương trình x² - 5x + 6 = 0"
                  className="w-full bg-slate-900/60 border border-slate-700/60 text-slate-200 placeholder-slate-600 rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-all shadow-inner"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-rose-400/80 uppercase tracking-widest mb-2">
                  Bài làm của học sinh
                </label>
                <textarea
                  value={studentAnswer}
                  onChange={(e) => setStudentAnswer(e.target.value)}
                  rows={3}
                  placeholder="Bước 1: x = ... Bước 2: ..."
                  className="w-full bg-slate-900/60 border border-slate-700/60 text-slate-200 placeholder-slate-600 rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-all shadow-inner"
                />
              </div>

              <button
                type="submit"
                disabled={isGrading || isDiagnosing || !problem.trim() || !studentAnswer.trim()}
                className="w-full mt-2 flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl px-4 py-3 text-[13px] transition-all shadow-lg shadow-indigo-500/20 active:scale-[0.98]"
              >
                {isGrading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>[Stage 1] Đang chấm bài...</span>
                  </>
                ) : isDiagnosing ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>[Stage 2] Đang xử lý CDM... (10s)</span>
                  </>
                ) : gradingData ? (
                  <>
                    <PlaySquare size={15} />
                    <span>Tiếp tục Chẩn đoán (Stage 2)</span>
                  </>
                ) : (
                  <>
                    <PlaySquare size={15} />
                    <span>Chấm bài & Chẩn đoán</span>
                  </>
                )}
              </button>
            </form>

            {/* Error State */}
            {error && (
              <div className="mx-6 mt-4 p-4 bg-rose-950/50 border border-rose-700/40 rounded-xl flex items-start space-x-3">
                <AlertOctagon size={16} className="text-rose-400 flex-shrink-0 mt-0.5" />
                <p className="text-rose-200 text-[13px] font-medium leading-relaxed">{error}</p>
              </div>
            )}

            {/* Shared Diagnostic Output View */}
            {(gradingData || result) && !(isGrading || isDiagnosing) && (
              <div className="px-6">
                <DiagnosticResultViewer 
                  gradingData={gradingData}
                  result={result}
                  onNodeHighlight={onNodeHighlight}
                  historyId={result?.history_id}
                />
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* HISTORY TAB */}
        {/* ============================================================== */}
        {activeTab === "HISTORY" && (
          <div className="p-6 animate-in fade-in slide-in-from-bottom-2 duration-300 h-full">
            {loadingHistory ? (
              <div className="flex flex-col items-center justify-center h-48 space-y-3">
                <Loader2 size={24} className="animate-spin text-indigo-500" />
                <p className="text-xs text-slate-500 font-medium">Đang tải lịch sử pipeline...</p>
              </div>
            ) : histories.length === 0 ? (
              <div className="flex flex-col items-center text-center py-12 px-6 border border-dashed border-slate-700/50 rounded-2xl bg-slate-800/20">
                <History size={32} className="text-slate-600 mb-4" />
                <p className="text-slate-400 text-[13px]">Chưa có lịch sử pipeline nào.</p>
              </div>
            ) : (
              <div className="space-y-4 pb-8">
                {histories.map((hx) => {
                  const isExpanded = expandedHistoryId === hx.id;
                  
                  let parsedGrading: GradingResult | null = null;
                  try { if (hx.gradingResult) parsedGrading = JSON.parse(hx.gradingResult); } catch (e) {}

                  let parsedDiagnostic: DiagnosticResult | null = null;
                  try { if (hx.diagnosticRaw) parsedDiagnostic = JSON.parse(hx.diagnosticRaw); } catch (e) {}

                  let renderedBugCount = parsedDiagnostic?.matches?.length || 0;

                  return (
                    <div 
                      key={hx.id} 
                      className={clsx(
                        "rounded-xl border transition-all duration-300 overflow-hidden group",
                        isExpanded 
                          ? "bg-slate-800/60 border-indigo-500/40 shadow-xl shadow-indigo-900/20" 
                          : "bg-slate-800/30 border-white/5 hover:bg-slate-800/50 hover:border-white/10"
                      )}
                    >
                      <div 
                        onClick={() => setExpandedHistoryId(isExpanded ? null : hx.id)}
                        className="p-4 cursor-pointer flex justify-between items-center bg-slate-800/40"
                      >
                         <div className="flex gap-3 flex-1 min-w-0 pr-4">
                            <div className="pt-0.5">
                              {renderedBugCount > 0 ? (
                                <div className="w-6 h-6 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center shadow-inner">
                                  <AlertOctagon size={14} />
                                </div>
                              ) : (
                                <div className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-inner">
                                  <CheckCircle size={14} />
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-medium text-slate-200 truncate leading-snug">
                                {hx.problem}
                              </p>
                              <div className="flex items-center gap-2 mt-2">
                                <span className="text-[9px] text-slate-500 font-mono">
                                  {new Date(hx.createdAt).toLocaleDateString('vi-VN')}
                                </span>
                                {renderedBugCount > 0 && (
                                   <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                     {renderedBugCount} Lỗi hổng (Gaps)
                                   </span>
                                )}
                              </div>
                            </div>
                         </div>
                         
                         <div className="flex items-center gap-3">
                            {renderScoreBadge(hx.totalScore, hx.maxScore ?? 1.0)}
                            <ChevronRight size={16} className={clsx("text-slate-500 transition-transform duration-300 flex-shrink-0", isExpanded && "rotate-90 text-indigo-400")} />
                         </div>
                      </div>

                      {/* Shared Component explicitly renders EXACTLY like in NEW tab  */}
                      {isExpanded && (
                        <div className="px-4 pb-2 border-t border-slate-700/50 bg-slate-900/20">
                           <DiagnosticResultViewer 
                              gradingData={parsedGrading}
                              result={parsedDiagnostic}
                              onNodeHighlight={onNodeHighlight}
                              historyId={hx.id}
                              initialExpertNotes={hx.expertNotes}
                           />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
