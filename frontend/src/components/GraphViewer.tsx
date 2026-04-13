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
import clsx from 'clsx';
import { Loader2, Layers, Microscope, X, Filter, Target } from 'lucide-react';

import ConceptNode from './ConceptNode';
import Sidebar from './Sidebar';
import DiagnosticChat from './DiagnosticChat';
import ConceptNavigator from './ConceptNavigator';

const nodeTypes = { concept: ConceptNode };

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const getLayoutedElements = (nodes: any[], edges: any[], direction = 'BT') => {
  if (nodes.length === 0) return { nodes, edges };
  
  const isHorizontal = direction === 'LR';
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 180, align: 'UL' });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => g.setNode(node.id, { width: 280, height: 70 }));
  edges.forEach((edge) => g.setEdge(edge.source, edge.target));
  dagre.layout(g);

  nodes.forEach((node) => {
    const pos = g.node(node.id);
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
  const [rawEdges, setRawEdges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConcept, setSelectedConcept] = useState<any>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<string[]>([]);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [showFullGraph, setShowFullGraph] = useState(true);

  const { fitView } = useReactFlow();

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/graph');
        const data = await res.json();
        setRawConcepts(data.nodes);
        setRawEdges(data.edges);

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

  // Logic to find neighborhood (related nodes)
  const getNeighborhoodIds = useCallback((focusId: string) => {
    const related = new Set<string>();
    related.add(focusId);

    // Add ancestors (prerequisites)
    const findAncestors = (id: string) => {
      rawEdges.forEach(edge => {
        if (edge.target === id && !related.has(edge.source)) {
          related.add(edge.source);
          findAncestors(edge.source);
        }
      });
    };

    // Add immediate consequences (children)
    const findChildren = (id: string) => {
      rawEdges.forEach(edge => {
        if (edge.source === id && !related.has(edge.target)) {
          related.add(edge.target);
          // Only immediate children for focus mode to avoid exploding the graph
        }
      });
    };

    findAncestors(focusId);
    findChildren(focusId);
    return Array.from(related);
  }, [rawEdges]);

  // Focus and Filter Effect
  useEffect(() => {
    if (nodes.length === 0) return;

    let targetNodes = rawConcepts.map(c => ({
      id: c.id,
      type: 'concept',
      data: { ...c },
      position: { x: 0, y: 0 }
    }));

    let targetEdges = rawEdges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#818cf8' },
      style: { stroke: '#94a3b8', strokeWidth: 2, opacity: 0.6 }
    }));

    if (focusNodeId && !showFullGraph) {
      const neighborhood = getNeighborhoodIds(focusNodeId);
      targetNodes = targetNodes.filter(n => neighborhood.includes(n.id));
      targetEdges = targetEdges.filter(e => neighborhood.includes(e.source) && neighborhood.includes(e.target));
    }

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(targetNodes, targetEdges, 'BT');
    
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);

    if (focusNodeId) {
      setTimeout(() => fitView({ nodes: [{ id: focusNodeId }], duration: 1000, padding: 1.5 }), 200);
    }
  }, [focusNodeId, showFullGraph, rawConcepts, rawEdges, fitView, setNodes, setEdges, getNeighborhoodIds]);

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
    setFocusNodeId(node.id);
  }, []);

  const handleNavigatorSelect = useCallback((id: string) => {
    const concept = rawConcepts.find(c => c.id === id);
    if (concept) {
      setSelectedConcept(concept);
      setFocusNodeId(id);
      setShowFullGraph(false); // Auto-focus in neighborhood mode when selecting from navigator
    }
  }, [rawConcepts]);

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
      <ConceptNavigator 
        concepts={rawConcepts} 
        onSelect={handleNavigatorSelect} 
        activeId={focusNodeId || undefined} 
      />

      <div className="flex-1 relative">
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
          <Panel position="top-left" className="bg-white/70 backdrop-blur-lg p-5 shadow-xl rounded-2xl border border-white/50 m-6 max-w-[320px]">
            <div className="flex items-center space-x-3 mb-2">
              <div className="p-1.5 bg-indigo-100 text-indigo-600 rounded-lg">
                <Layers size={18} />
              </div>
              <h1 className="text-xl font-black text-slate-900 tracking-tight">KST Engine</h1>
            </div>
            
            <div className="flex items-center space-x-2 mt-4 p-1 bg-slate-100/50 rounded-xl border border-slate-200/30">
              <button 
                onClick={() => setShowFullGraph(true)}
                className={clsx(
                  "flex-1 flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded-lg text-[11px] font-bold transition-all",
                  showFullGraph ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
                )}
              >
                <Filter size={12} />
                <span>Toàn cảnh</span>
              </button>
              <button 
                onClick={() => setShowFullGraph(false)}
                className={clsx(
                  "flex-1 flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded-lg text-[11px] font-bold transition-all",
                  !showFullGraph ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
                )}
              >
                <Target size={12} />
                <span>Focus Mode</span>
              </button>
            </div>
          </Panel>

          {/* Focus mode indicator */}
          {focusNodeId && !showFullGraph && (
            <Panel position="top-right" className="m-8">
               <div className="bg-indigo-600 text-white px-4 py-2 rounded-xl shadow-lg flex items-center space-x-2 font-bold text-xs animate-in slide-in-from-top duration-500">
                 <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                 <span>Viewing Neighborhood: {focusNodeId}</span>
                 <button 
                   onClick={() => setShowFullGraph(true)}
                   className="ml-2 p-1 hover:bg-white/20 rounded"
                 >
                   <X size={14} />
                 </button>
               </div>
            </Panel>
          )}

          {/* Highlight indicator */}
          {highlightedNodeIds.length > 0 && (
            <Panel position="bottom-right" className="m-8">
              <div className="flex flex-col items-end space-y-2">
                <div className="flex items-center space-x-2 bg-rose-600/90 backdrop-blur-sm text-white text-[11px] font-bold px-4 py-2.5 rounded-xl shadow-lg">
                  <span className="animate-pulse">📍 Highlight {highlightedNodeIds.length} lỗ hổng</span>
                  <button onClick={clearHighlight} className="ml-1 hover:opacity-70 transition-opacity">
                    <X size={12} />
                  </button>
                </div>
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>

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
