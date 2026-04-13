import { X, CheckCircle2, AlertOctagon, Sparkles } from "lucide-react";
import clsx from "clsx";

export default function Sidebar({ concept, onClose }: { concept: any, onClose: () => void }) {
  if (!concept) return null;

  const parsedMisconceptions = concept.misconceptions
    .split(/\d+\.\s/)
    .filter((str: string) => str.trim().length > 0)
    .map((str: string) => str.trim());

  return (
    <div className="fixed top-0 left-0 w-[420px] h-full bg-slate-50/70 backdrop-blur-3xl border-r border-white/60 shadow-2xl p-8 overflow-y-auto z-50 flex flex-col transform transition-transform duration-300 ease-out">
      
      {/* Header Button */}
      <div className="flex justify-end w-full">
        <button 
          onClick={onClose} 
          className="p-2 text-slate-400 hover:text-slate-800 bg-white/60 hover:bg-white shadow-sm border border-slate-200/50 rounded-full transition-all"
        >
          <X size={18} strokeWidth={2.5} />
        </button>
      </div>

      <div className="mb-8 mt-2 space-y-4">
        <div className="flex items-center space-x-2">
            <span className="inline-block px-3 py-1 bg-indigo-600 text-white text-[10px] uppercase font-black tracking-widest rounded-md shadow-sm">
            {concept.id}
            </span>
            <span className="inline-block px-3 py-1 bg-indigo-50/80 text-indigo-700 text-xs font-semibold rounded-md border border-indigo-100">
            {concept.topicCategory}
            </span>
        </div>
        
        <h2 className="text-[28px] font-extrabold text-slate-900 tracking-tight leading-snug">{concept.nameVn}</h2>
        <div className="flex items-center text-sm font-semibold text-slate-500">
           <span className="w-2 h-2 rounded-full bg-slate-300 mr-2 shadow-inner"></span> Grade {concept.gradeLevel} 
        </div>
      </div>

      <div className="space-y-8 pb-12">
        
        {/* Description Block */}
        <section className="relative">
          <h3 className="flex items-center text-xs font-black text-slate-400 uppercase tracking-widest mb-3">
            <Sparkles size={14} className="mr-2 text-slate-400" />
            Concept Focus
          </h3>
          <p className="text-slate-700 text-[15px] leading-relaxed">
            {concept.description}
          </p>
        </section>

        {/* Mastery Question Block */}
        <section>
          <h3 className="flex items-center text-xs font-black text-emerald-600 uppercase tracking-widest mb-3">
            <CheckCircle2 size={16} className="mr-2 text-emerald-500" />
            Mastery Target
          </h3>
          <div className="relative bg-gradient-to-br from-emerald-50 to-teal-50/50 border-l-[6px] border-emerald-500 p-5 rounded-r-2xl shadow-sm text-emerald-950 font-medium text-[15px] leading-relaxed">
            {concept.masteryQuestion}
          </div>
        </section>

        {/* Misconceptions Block */}
        {parsedMisconceptions.length > 0 && (
          <section>
            <h3 className="flex items-center text-xs font-black text-rose-500 uppercase tracking-widest mb-3">
              <AlertOctagon size={16} className="mr-2 text-rose-500" />
              Common Trap Analysis
            </h3>
            <ul className="space-y-3">
              {parsedMisconceptions.map((misc: string, idx: number) => (
                <li key={idx} className="group flex items-start bg-white/80 hover:bg-white p-4 rounded-xl border border-rose-100/50 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
                  <div className="bg-rose-100 p-1.5 rounded-lg shadow-inner mr-4 flex-shrink-0 mt-0.5">
                    <AlertOctagon size={14} className="text-rose-600" />
                  </div>
                  <span className="text-[14px] text-slate-700 font-semibold leading-relaxed group-hover:text-slate-900 transition-colors">{misc}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
