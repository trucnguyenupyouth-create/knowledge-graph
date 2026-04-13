import React, { useState, useMemo } from 'react';
import { Search, ChevronRight, ChevronDown, Rocket, GraduationCap, MapPinned } from 'lucide-react';
import clsx from 'clsx';

interface Concept {
  id: string;
  gradeLevel: number;
  topicCategory: string;
  nameVn: string;
}

interface ConceptNavigatorProps {
  concepts: Concept[];
  onSelect: (id: string) => void;
  activeId?: string;
}

export default function ConceptNavigator({ concepts, onSelect, activeId }: ConceptNavigatorProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedGrades, setExpandedGrades] = useState<number[]>([9, 8, 7, 6]);

  const toggleGrade = (grade: number) => {
    setExpandedGrades(prev => 
      prev.includes(grade) ? prev.filter(g => g !== grade) : [...prev, grade]
    );
  };

  const filteredConcepts = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return concepts.filter(c => 
      c.nameVn.toLowerCase().includes(term) || 
      c.id.toLowerCase().includes(term)
    );
  }, [concepts, searchTerm]);

  // Grouping: Grade -> Topic -> Concepts
  const grouped = useMemo(() => {
    const grades: Record<number, Record<string, Concept[]>> = {};
    
    filteredConcepts.forEach(c => {
      if (!grades[c.gradeLevel]) grades[c.gradeLevel] = {};
      const topic = c.topicCategory || 'Khác';
      if (!grades[c.gradeLevel][topic]) grades[c.gradeLevel][topic] = [];
      grades[c.gradeLevel][topic].push(c);
    });

    return grades;
  }, [filteredConcepts]);

  const gradeList = Object.keys(grouped).map(Number).sort((a, b) => b - a);

  const getTopicIcon = (topic: string) => {
    if (topic.includes('Đại số') || topic.includes('ALG')) return '∑';
    if (topic.includes('Hình học') || topic.includes('GEO')) return '△';
    return '•';
  };

  return (
    <div className="w-80 h-full flex flex-col bg-slate-50 border-r border-slate-200 z-30 font-sans shadow-xl shadow-slate-200/50">
      {/* Header */}
      <div className="p-6 bg-white border-b border-slate-100">
        <div className="flex items-center space-x-2 mb-5">
           <MapPinned className="text-indigo-600" size={20} />
           <h2 className="text-[15px] font-black text-slate-800 uppercase tracking-tight">Danh mục Kiến thức</h2>
        </div>
        
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={16} />
          <input 
            type="text"
            placeholder="Tìm kiếm bài học..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-100 border-none rounded-xl py-2.5 pl-10 pr-4 text-sm font-medium focus:ring-2 focus:ring-indigo-100 focus:bg-white transition-all outline-none placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {gradeList.length === 0 && (
          <div className="py-20 text-center">
            <p className="text-slate-400 text-sm font-medium">Không tìm thấy kiến thức này</p>
          </div>
        )}

        {gradeList.map(grade => (
          <div key={grade} className="space-y-1">
            <button 
              onClick={() => toggleGrade(grade)}
              className="w-full flex items-center justify-between p-2 hover:bg-white rounded-lg transition-colors group"
            >
              <div className="flex items-center space-x-2.5">
                <div className={clsx(
                  "w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-black shadow-sm",
                  grade === 9 ? "bg-rose-100 text-rose-600" :
                  grade === 8 ? "bg-orange-100 text-orange-600" :
                  grade === 7 ? "bg-amber-100 text-amber-600" : "bg-emerald-100 text-emerald-600"
                )}>
                  G{grade}
                </div>
                <span className="text-[13px] font-bold text-slate-700">Lớp {grade}</span>
              </div>
              {expandedGrades.includes(grade) ? 
                <ChevronDown size={14} className="text-slate-400" /> : 
                <ChevronRight size={14} className="text-slate-400" />
              }
            </button>

            {expandedGrades.includes(grade) && (
              <div className="ml-4 border-l-2 border-slate-100 pl-2 py-1 space-y-4">
                {Object.entries(grouped[grade]).map(([topic, items]) => (
                  <div key={topic} className="space-y-1">
                    <div className="text-[10px] uppercase font-black text-slate-400 tracking-wider mb-2 pl-2 flex items-center">
                       <span className="mr-2 opacity-50">{getTopicIcon(topic)}</span>
                       {topic}
                    </div>
                    {items.map(concept => (
                      <button
                        key={concept.id}
                        onClick={() => onSelect(concept.id)}
                        className={clsx(
                          "w-full text-left p-2.5 rounded-xl transition-all duration-200 group relative",
                          activeId === concept.id 
                            ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20 translate-x-1" 
                            : "hover:bg-white text-slate-600 hover:text-indigo-600 hover:shadow-sm"
                        )}
                      >
                        <div className="text-[11px] font-bold opacity-60 font-mono mb-0.5">{concept.id}</div>
                        <div className="text-[12px] font-bold leading-tight line-clamp-2">{concept.nameVn}</div>
                        {activeId === concept.id && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <Rocket size={12} className="animate-pulse" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-4 bg-white border-t border-slate-100">
         <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 px-2 uppercase tracking-widest">
            <span>Total Nodes</span>
            <span className="text-slate-600">{concepts.length}</span>
         </div>
      </div>
    </div>
  );
}
