import { Handle, Position } from "reactflow";
import { CircleDot, BrainCircuit, BookType, Sparkles } from "lucide-react";
import clsx from "clsx";

export default function ConceptNode({ data }: { data: any }) {
  const { gradeLevel, nameVn, conceptCode, isHighlighted, isDimmed } = data;

  const getStyleConfigs = (grade: number) => {
    switch (grade) {
      case 9: return {
        bg: "bg-white/95 hover:bg-rose-50/80",
        border: "border-rose-200 hover:border-rose-400",
        shadow: "shadow-rose-100/60",
        badge: "bg-rose-100 text-rose-800 border-rose-200",
        icon: <BrainCircuit size={16} className="text-rose-500" />
      };
      case 8: return {
        bg: "bg-white/95 hover:bg-orange-50/80",
        border: "border-orange-200 hover:border-orange-400",
        shadow: "shadow-orange-100/60",
        badge: "bg-orange-100 text-orange-800 border-orange-200",
        icon: <BookType size={16} className="text-orange-500" />
      };
      case 7: return {
        bg: "bg-white/95 hover:bg-amber-50/80",
        border: "border-amber-200 hover:border-amber-400",
        shadow: "shadow-amber-100/60",
        badge: "bg-amber-100 text-amber-800 border-amber-200",
        icon: <CircleDot size={16} className="text-amber-500" />
      };
      case 6: return {
        bg: "bg-white/95 hover:bg-emerald-50/80",
        border: "border-emerald-200 hover:border-emerald-400",
        shadow: "shadow-emerald-100/60",
        badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
        icon: <Sparkles size={16} className="text-emerald-500" />
      };
      default: return {
        bg: "bg-white/95 hover:bg-slate-50/80",
        border: "border-slate-200 hover:border-slate-400",
        shadow: "shadow-slate-100/60",
        badge: "bg-slate-100 text-slate-800 border-slate-200",
        icon: <CircleDot size={16} className="text-slate-500" />
      };
    }
  };

  const style = getStyleConfigs(gradeLevel);

  return (
    <div className={clsx(
      "group relative flex items-center w-[280px] p-3 rounded-2xl border-[1.5px] backdrop-blur-md transition-all duration-300 ease-out hover:-translate-y-1 shadow-lg hover:shadow-xl",
      style.bg, style.border, style.shadow,
      isHighlighted && "!border-rose-500 !shadow-rose-300/80 ring-2 ring-rose-400 ring-offset-2 scale-105",
      isDimmed && "opacity-30 scale-95",
    )}>

      {/* Pulsing ring for highlighted (root gap) node */}
      {isHighlighted && (
        <div className="absolute inset-0 rounded-2xl ring-2 ring-rose-400 animate-ping opacity-40 pointer-events-none" />
      )}

      {/* Target handle (input) */}
      <Handle 
        type="target" 
        position={Position.Bottom} 
        className="w-4 h-4 bg-slate-700 border-2 border-white rounded-full translate-y-1.5 shadow-sm transition-transform group-hover:scale-125" 
      />
      
      <div className="flex-shrink-0 w-11 h-11 mr-3 flex items-center justify-center rounded-[14px] bg-white shadow-sm border border-slate-100 group-hover:scale-105 transition-transform">
        {style.icon}
      </div>

      <div className="flex flex-col flex-1 overflow-hidden pr-2">
        <div className="flex items-center justify-between mb-1">
           <span className="text-[11px] font-bold font-mono tracking-wider text-slate-400 group-hover:text-slate-600 transition-colors">
             {conceptCode}
           </span>
           <span className={clsx("text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border", style.badge)}>
             G{gradeLevel}
           </span>
        </div>
        <div className="text-[13px] font-bold text-slate-800 leading-tight block line-clamp-2">
          {nameVn}
        </div>
      </div>

      {/* Source handle (output) */}
      <Handle 
        type="source" 
        position={Position.Top} 
        className="w-4 h-4 bg-slate-700 border-2 border-white rounded-full -translate-y-1.5 shadow-sm transition-transform group-hover:scale-125" 
      />
    </div>
  );
}
