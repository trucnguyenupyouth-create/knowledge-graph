"use client";

import React, { useState, useEffect, useCallback } from 'react';
import ReactFlow, {
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  ConnectionLineType,
  Panel,
  BackgroundVariant,
  useReactFlow
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { Loader2, Layers, Microscope, X } from 'lucide-react';

import ConceptNode from './ConceptNode';
import Sidebar from './Sidebar';
import DiagnosticChat from './DiagnosticChat';

const nodeTypes = { concept: ConceptNode };

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const getLayoutedElements = (nodes: any[], edges: any[], direction = 'BT') => {
  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({ rankdir: direction, nodesep: 60, ranksep: 180, align: 'UL' });
  nodes.forEach((node) => dagreGraph.setNode(node.id, { width: 280, height: 70 }));
  edges.forEach((edge) => dagreGraph.setEdge(edge.source, edge.target));
  dagre.layout(dagreGraph);
  nodes.forEach((node) => {
    const pos = dagreGraph.node(node.id);
    node.targetPosition = isHorizontal ? 'left' : 'bottom';
    node.sourcePosition = isHorizontal ? 'right' : 'top';
    node.position = { x: pos.x - 140, y: pos.y - 35 };
  });
  return { nodes, edges };
};

// ─── Inner component (needs access to useReactFlow) ──────────────────────────

function GraphViewerInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [rawConcepts, setRawConcepts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConcept, setSelectedConcept] = useState<any>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<string[]>([]);

  const { fitView } = useReactFlow();

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/graph');
        const data = await res.json();
        setRawConcepts(data.nodes);

        const initialNodes = data.nodes.map((node: any) => ({
          id: node.id,
          type: 'concept',
          data: { ...node },
          position: { x: 0, y: 0 },
        }));

        const initialEdges = data.edges.map((edge: any) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: 'smoothstep',
          animated: true,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: '#818cf8',
          },
          style: { stroke: '#94a3b8', strokeWidth: 2, opacity: 0.6 },
        }));

        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(initialNodes, initialEdges, 'BT');
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
      } catch (err) {
        console.error('Failed to load graph:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [setNodes, setEdges]);

  // Highlight effect
  useEffect(() => {
    if (nodes.length > 0) {
      setNodes((nds) => {
        let isChanged = false;
        const newNds = nds.map((node) => {
          const isHighlighted = highlightedNodeIds.includes(node.id);
          const isDimmed = highlightedNodeIds.length > 0 && !isHighlighted;

          if (node.data.isHighlighted !== isHighlighted || node.data.isDimmed !== isDimmed) {
            isChanged = true;
            return {
              ...node,
              data: { ...node.data, isHighlighted, isDimmed },
            };
          }
          return node;
        });
        return isChanged ? newNds : nds;
      });

      if (highlightedNodeIds.length > 0) {
        setTimeout(() => fitView({ nodes: highlightedNodeIds.map(id => ({ id })), duration: 800, padding: 0.5 }), 100);
      }
    }
  }, [highlightedNodeIds, nodes.length, fitView, setNodes]);

  const handleNodeHighlight = useCallback((conceptIds: string[]) => {
    setHighlightedNodeIds(conceptIds);
  }, []);

  const clearHighlight = useCallback(() => {
    setHighlightedNodeIds([]);
  }, []);

  const onNodeClick = useCallback((event: React.MouseEvent, node: any) => {
    setSelectedConcept({ id: node.id, ...node.data });
  }, []);

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50">
        <div className="relative flex justify-center items-center">
          <div className="absolute animate-ping w-24 h-24 rounded-full bg-indigo-100 opacity-60" />
          <Loader2 className="w-12 h-12 animate-spin text-indigo-600 relative z-10" />
        </div>
        <p className="text-slate-400 font-bold mt-8 tracking-widest uppercase text-xs">
          Computing Dagre Graph Topology...
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-slate-50 relative overflow-hidden flex font-sans">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        minZoom={0.05}
        maxZoom={1.5}
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background
          color="#cbd5e1"
          variant={BackgroundVariant.Dots}
          gap={32}
          size={1.5}
          className="opacity-70"
        />
        <Controls className="bg-white/80 backdrop-blur-md rounded-xl shadow-lg border border-slate-200/50 mb-12" showInteractive={false} />

        {/* Info Panel */}
        <Panel position="top-left" className="bg-white/80 backdrop-blur-xl p-6 shadow-2xl rounded-2xl border border-white m-8 max-w-[380px]">
          <div className="flex items-center space-x-3 mb-3">
            <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl shadow-inner">
              <Layers size={20} className="stroke-[2.5]" />
            </div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">KST Engine</h1>
          </div>
          <p className="text-[13px] text-slate-500 font-medium leading-relaxed">
            Deterministic pedagogical timeline — Grade 6 foundations to Grade 9 mastery.
          </p>
          <div className="mt-4 pt-4 border-t border-slate-200/60 grid grid-cols-2 gap-y-2.5">
            {[
              { color: 'bg-emerald-400', label: 'Grade 6' },
              { color: 'bg-amber-400', label: 'Grade 7' },
              { color: 'bg-orange-400', label: 'Grade 8' },
              { color: 'bg-rose-400', label: 'Grade 9' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center">
                <div className={`w-3 h-3 rounded ${color} shadow-sm`} />
                <span className="text-xs font-bold text-slate-600 ml-2">{label}</span>
              </div>
            ))}
          </div>
        </Panel>

        {/* Highlight indicator + clear button */}
        {highlightedNodeIds.length > 0 && (
          <Panel position="top-right" className="m-8">
            <div className="flex flex-col items-end space-y-2">
              <div className="flex items-center space-x-2 bg-rose-600/90 backdrop-blur-sm text-white text-[12px] font-bold px-4 py-2.5 rounded-xl shadow-lg shadow-rose-500/30">
                <span>📍 Đang highlight {highlightedNodeIds.length} Lỗ hổng</span>
                <button onClick={clearHighlight} className="ml-1 hover:opacity-70 transition-opacity">
                  <X size={14} />
                </button>
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>

      {/* Concept Detail Sidebar */}
      {selectedConcept && (
        <Sidebar concept={selectedConcept} onClose={() => setSelectedConcept(null)} />
      )}

      {/* Diagnostic Chat Panel */}
      {showDiagnostics && (
        <DiagnosticChat
          onClose={() => setShowDiagnostics(false)}
          onNodeHighlight={handleNodeHighlight}
          availableConcepts={rawConcepts}
        />
      )}

      {/* Floating Diagnostic Button */}
      {!showDiagnostics && (
        <button
          onClick={() => setShowDiagnostics(true)}
          className="fixed bottom-8 right-8 flex items-center space-x-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[13px] px-5 py-3.5 rounded-2xl shadow-2xl shadow-indigo-500/40 hover:shadow-indigo-500/60 transition-all hover:-translate-y-0.5 z-40"
        >
          <Microscope size={18} />
          <span>Chẩn đoán Lỗ hổng</span>
        </button>
      )}
    </div>
  );
}

// ─── Outer wrapper (provides ReactFlowProvider context) ──────────────────────

import { ReactFlowProvider } from 'reactflow';

export default function GraphViewer() {
  return (
    <ReactFlowProvider>
      <GraphViewerInner />
    </ReactFlowProvider>
  );
}
