import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import ReactFlow, { Background, Controls, Handle, Position, Panel } from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import ReactMarkdown from 'react-markdown';
import { toast } from 'react-hot-toast';
import api from '../api/axios';
import useHindiVoice from '../hooks/useHindiVoice';

// Required for react-pdf
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

const getLayoutedElements = (nodes, edges, direction = 'LR') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  
  const nodeWidth = 250;
  const nodeHeight = 120;

  dagreGraph.setGraph({ rankdir: direction, nodesep: 50, ranksep: 100 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.targetPosition = 'left';
    node.sourcePosition = 'right';

    // Shift anchor point back to top left for React Flow
    node.position = {
      x: nodeWithPosition.x - nodeWidth / 2,
      y: nodeWithPosition.y - nodeHeight / 2,
    };
  });

  return { nodes, edges };
};

const ConceptNode = ({ data }) => {
  return (
    <div className="bg-slate-800 border-2 border-slate-700 rounded-lg p-3 min-w-[150px] shadow-lg">
      <Handle type="target" position={Position.Left} />
      <div className="font-bold text-sm text-sky-400 text-center">{data.label}</div>
      {data.formula_or_detail && (
         <div className="mt-2 text-xs text-slate-300 bg-slate-900 p-1.5 rounded text-center font-mono">
           {data.formula_or_detail}
         </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
};

export default function Library() {
  const navigate = useNavigate();
  const flowWrapperRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const nodeTypes = useMemo(() => ({ custom: ConceptNode }), []);
  const [documents, setDocuments] = useState([]);
  const [activeDocIds, setActiveDocIds] = useState([]);
  const [currentSubject, setCurrentSubject] = useState('General');
  
  const [chatHistory, setChatHistory] = useState([]);
  const [question, setQuestion] = useState("");
  const [socraticMode, setSocraticMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const [conceptGraph, setConceptGraph] = useState({ nodes: [], links: [] });
  const [scratchpadNotes, setScratchpadNotes] = useState([]);
  
  const { transcript, isListening, startListening, stopListening, speakHindi } = useHindiVoice();
  const [isVoiceMuted, setIsVoiceMuted] = useState(false);

  useEffect(() => {
    if (transcript && !isListening) {
      setQuestion(transcript);
      setTimeout(() => {
        const askBtn = document.getElementById('library-ask-btn');
        if (askBtn) askBtn.click();
      }, 50);
    }
  }, [transcript, isListening]);

  // PDF Viewer State
  const [selectedPdfUrl] = useState(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [numPages, setNumPages] = useState(null);

  useEffect(() => {
    fetchDocuments();
    fetchNotes();
    fetchProfile();

    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      flowWrapperRef.current?.requestFullscreen().catch(err => console.error(err));
    } else {
      document.exitFullscreen().catch(err => console.error(err));
    }
  };

  const fetchProfile = async () => {
    try {
      const res = await api.get('/auth/me');
      const subject = res.data?.active_subjects?.[0];
      if (subject) setCurrentSubject(subject);
    } catch (err) {
      console.error("Failed to fetch profile", err);
    }
  };

  const fetchNotes = async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      const res = await api.get('/library/scratchpad');
      setScratchpadNotes(res.data.notes || []);
    } catch (err) {
      console.error("Failed to fetch notes", err);
    }
  };

  const fetchDocuments = async () => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      console.error("No token found. Please log in.");
      return;
    }
    try {
      const res = await api.get('/library/documents');
      setDocuments(res.data || []);
    } catch (err) {
      console.error("Failed to fetch documents", err);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const token = localStorage.getItem("access_token");
    if (!token) return alert("You must be logged in to upload documents.");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("subject", currentSubject || 'General');
    
    try {
      setIsLoading(true);
      await api.post('/library/upload', formData, {
        headers: {
          "Content-Type": "multipart/form-data"
        }
      });
      fetchDocuments();
    } catch (err) {
      console.error("Upload failed", err);
      // Surface what actually went wrong instead of guessing at a cause.
      const detail = err?.response?.data?.detail;
      toast.error(
        detail
          ? `Upload failed: ${detail}`
          : `Upload failed: ${err?.message || "please try again"}`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const toggleDoc = (docId) => {
    setActiveDocIds(prev => 
      prev.includes(docId) ? prev.filter(id => id !== docId) : [...prev, docId]
    );
  };

  const handleAsk = async (e) => {
    const textToAsk = typeof e === 'string' ? e : question;
    if (!textToAsk.trim()) return;
    
    const token = localStorage.getItem("access_token");
    if (!token) return alert("You must be logged in to ask questions.");

    const newMessage = { role: "user", text: textToAsk };
    setChatHistory(prev => [...prev, newMessage]);
    setQuestion("");
    setIsLoading(true);

    try {
      const res = await api.post('/library/ask', {
        question: newMessage.text,
        active_doc_ids: activeDocIds,
        socratic_mode: socraticMode
      });
      
      const { answer, concept_nodes, concept_edges } = res.data;
      
      setChatHistory(prev => [...prev, { role: "assistant", text: answer }]);
      
      if (!isVoiceMuted && speakHindi) {
        speakHindi(answer);
      }

      if (concept_nodes && concept_edges) {
        const initialNodes = concept_nodes.map(n => ({
          id: n.id,
          type: 'custom',
          data: { label: n.label, formula_or_detail: n.formula_or_detail },
          position: { x: 0, y: 0 }
        }));
        
        const initialEdges = [];

        concept_edges.forEach((e, idx) => {
          let sourceExists = initialNodes.find(n => n.id === e.source);
          let targetExists = initialNodes.find(n => n.id === e.target);
          
          if (!sourceExists) {
            initialNodes.push({ id: e.source, type: 'custom', data: { label: e.source }, position: { x: 0, y: 0 } });
          }
          if (!targetExists) {
            initialNodes.push({ id: e.target, type: 'custom', data: { label: e.target }, position: { x: 0, y: 0 } });
          }
          
          initialEdges.push({ 
             id: `e-${e.source}-${e.target}-${idx}`, 
             source: e.source, 
             target: e.target, 
             label: e.label,
             type: 'smoothstep',
             animated: true,
             style: { stroke: '#475569', strokeWidth: 2 },
             labelStyle: { fill: '#94a3b8', fontWeight: 700, fontSize: 10 }
          });
        });
        
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(initialNodes, initialEdges, 'LR');
        setConceptGraph({ nodes: layoutedNodes, edges: layoutedEdges });
      }
    } catch (err) {
      console.error("Ask failed", err);
      setChatHistory(prev => [...prev, { role: "assistant", text: "Error fetching answer." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const generatePractice = async () => {
    if (activeDocIds.length === 0) return alert("Please select at least one Active Source to generate practice questions.");
    
    const token = localStorage.getItem("access_token");
    if (!token) return alert("You must be logged in to generate practice.");

    navigate('/arena', { state: { activeDocIds: activeDocIds, mode: 'resource_bot' } });
  };

  const appendToScratchpad = async (text) => {
    const token = localStorage.getItem("access_token");
    if (!token) return alert("Must be logged in to save notes.");
    try {
      const res = await api.post('/library/scratchpad', { text });
      setScratchpadNotes(prev => [...prev, res.data.note]);
    } catch (err) {
      console.error(err);
      alert("Failed to save note");
    }
  };

  // Custom Markdown renderer for citations [DocName, Page X]
  const MarkdownComponents = {
    p: ({ children }) => {
      if (!children) return <p>{children}</p>;
      const renderChild = (child) => {
        if (typeof child !== 'string') return child;
        const parts = child.split(/(\[[^\]]+, Page \d+\])/g);
        return parts.map((part, i) => {
          const match = part.match(/\[([^\]]+), Page (\d+)\]/);
          if (match) {
            return (
              <span 
                key={i} 
                className="inline-flex items-center gap-1 bg-primary/20 text-primary px-2 py-0.5 rounded cursor-pointer hover:bg-primary/40 mx-1 text-xs font-bold"
                onClick={() => {
                  setPdfPage(parseInt(match[2]));
                  // In a real app we'd load the specific PDF blob or URL
                  // setSelectedPdfUrl(match[1]);
                }}
              >
                <span className="material-symbols-outlined text-[10px]">menu_book</span>
                {match[1]} p.{match[2]}
              </span>
            );
          }
          return part;
        });
      };
      
      return <p className="mb-2 leading-relaxed">{React.Children.map(children, renderChild)}</p>;
    }
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex overflow-hidden w-full -mt-8 -mx-8 bg-surface">
      
      {/* LEFT PANE: Documents & PDF Viewer */}
      <section className="w-1/4 h-full bg-surface-container-low border-r border-outline-variant/10 flex flex-col">
        <div className="p-4 border-b border-outline-variant/10">
          <h2 className="font-headline font-bold text-lg mb-4">Active Sources</h2>
          <label className="flex items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 cursor-pointer transition-colors text-primary text-sm font-semibold">
            <span className="material-symbols-outlined">upload_file</span>
            Upload PDF
            <input type="file" className="hidden" accept="application/pdf" onChange={handleFileUpload} />
          </label>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {documents.map(doc => (
            <div 
              key={doc.doc_id} 
              className={`p-3 rounded-lg border cursor-pointer flex items-center gap-3 ${activeDocIds.includes(doc.doc_id) ? 'bg-primary/20 border-primary/50' : 'bg-surface-container-high border-transparent'}`}
              onClick={() => toggleDoc(doc.doc_id)}
            >
              <span className={`material-symbols-outlined ${activeDocIds.includes(doc.doc_id) ? 'text-primary' : 'text-outline'}`}>
                {activeDocIds.includes(doc.doc_id) ? 'check_circle' : 'radio_button_unchecked'}
              </span>
              <p className="text-sm font-semibold truncate flex-1">{doc.doc_name}</p>
            </div>
          ))}
        </div>

        {/* Mini PDF Viewer (would require actual PDF URLs to render fully) */}
        {selectedPdfUrl && (
          <div className="h-1/2 border-t border-outline-variant/10 bg-surface-container-highest p-4 overflow-auto">
             <Document 
                file={selectedPdfUrl} 
                onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                className="flex flex-col items-center"
             >
                <Page pageNumber={pdfPage} width={250} renderTextLayer={false} renderAnnotationLayer={false} />
             </Document>
             <div className="text-center text-xs mt-2 text-outline">Page {pdfPage} of {numPages}</div>
          </div>
        )}
      </section>

      {/* MIDDLE PANE: Concept Graph */}
      <section className="w-1/3 h-full bg-surface-container-lowest border-r border-outline-variant/10 flex flex-col relative">
        <div className="absolute top-4 left-4 z-10 bg-surface-container-high/80 backdrop-blur-md px-3 py-1 rounded-full text-xs font-bold border border-outline-variant/20 flex items-center gap-2">
          <span className="material-symbols-outlined text-[14px] text-tertiary">hub</span>
          Concept Map
        </div>
        <div ref={flowWrapperRef} className="flex-1 w-full bg-[#0d1117] relative h-full">
          {/* using a dark background for the graph for premium feel */}
          <ReactFlow
            nodes={conceptGraph.nodes}
            edges={conceptGraph.edges}
            nodeTypes={nodeTypes}
            fitView
            attributionPosition="bottom-right"
            proOptions={{ hideAttribution: true }}
          >
            <Panel position="top-right">
              <button 
                onClick={toggleFullscreen} 
                className="bg-surface-container-highest hover:bg-surface-container text-on-surface p-2 rounded-lg shadow-md border border-outline-variant/20 flex items-center justify-center gap-2 text-xs font-bold transition-colors z-50 pointer-events-auto"
                title="Toggle Fullscreen"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {isFullscreen ? 'fullscreen_exit' : 'fullscreen'}
                </span>
                {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
              </button>
            </Panel>
            <Background color="#334155" gap={16} variant="dots" />
            <div className="z-50 relative"><Controls /></div>
          </ReactFlow>
        </div>
      </section>

      {/* RIGHT PANE: Chat & Scratchpad */}
      <section className="flex-1 flex flex-col bg-surface h-full min-h-0 overflow-hidden">
        {/* Chat Area */}
        <div className="flex-[3] flex flex-col border-b border-outline-variant/10 min-h-0 overflow-hidden">
          <div className="shrink-0 p-4 flex justify-between items-center glass-[45,52,73,0.6] bg-surface-container-low border-b border-outline-variant/10 h-16">
             <h2 className="font-headline font-bold flex items-center gap-2">
               <span className="material-symbols-outlined text-secondary">psychology</span> Tutor AI
             </h2>
             <div className="flex items-center gap-4">
               <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-outline">
                 <span className="material-symbols-outlined text-[18px]">
                   {isVoiceMuted ? 'volume_off' : 'volume_up'}
                 </span>
                 <input type="checkbox" className="toggle toggle-sm" checked={isVoiceMuted} onChange={e => setIsVoiceMuted(e.target.checked)} />
                 Mute AI Voice
               </label>
               <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                 <input type="checkbox" className="toggle toggle-secondary toggle-sm" checked={socraticMode} onChange={e => setSocraticMode(e.target.checked)} />
                 Socratic Mode
               </label>
             </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {chatHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-4 rounded-2xl text-sm ${msg.role === 'user' ? 'bg-primary/20 text-on-surface rounded-tr-none' : 'bg-surface-container-high border-l-2 border-secondary rounded-tl-none'}`}>
                  {msg.role === 'assistant' ? (
                    <div>
                      <ReactMarkdown components={MarkdownComponents}>{msg.text}</ReactMarkdown>
                      <button onClick={() => appendToScratchpad(msg.text)} className="mt-3 flex items-center gap-1 text-[10px] uppercase font-bold text-secondary bg-secondary/10 px-2 py-1 rounded hover:bg-secondary/20 transition-colors">
                        <span className="material-symbols-outlined text-[12px]">add</span> Save to Scratchpad
                      </button>
                    </div>
                  ) : msg.text}
                </div>
              </div>
            ))}
            {isLoading && <div className="text-sm text-outline animate-pulse p-2">Thinking...</div>}
          </div>

          <div className="shrink-0 p-4 border-t bg-surface-container-lowest border-outline-variant/5">
            <div className="flex items-center gap-2 bg-surface-container-high p-2 rounded-xl">
              <button 
                 onClick={isListening ? stopListening : startListening} 
                 className={`p-2 flex items-center justify-center rounded-lg transition-colors ${isListening ? 'bg-error text-on-error animate-pulse' : 'bg-surface-container-highest text-on-surface hover:bg-surface-container'}`}
                 title="Hindi Voice Chat"
              >
                <span className="material-symbols-outlined">{isListening ? 'mic' : 'mic_none'}</span>
              </button>
              <input 
                 value={isListening ? transcript : question} 
                 onChange={e => !isListening && setQuestion(e.target.value)} 
                 onKeyDown={e => e.key === 'Enter' && !isListening && handleAsk()}
                 placeholder={isListening ? "Listening..." : "Ask a question about your documents..."}
                 className={`flex-1 bg-transparent border-none outline-none px-3 text-sm placeholder:text-outline ${isListening ? 'text-primary animate-pulse' : ''}`}
                 readOnly={isListening}
              />
              <button id="library-ask-btn" onClick={handleAsk} disabled={isLoading || isListening} className="bg-primary p-2 flex items-center justify-center rounded-lg text-on-primary disabled:opacity-50">
                <span className="material-symbols-outlined">send</span>
              </button>
            </div>
          </div>
        </div>

        {/* Scratchpad Area */}
        <div className="flex-[2] flex flex-col bg-surface-container-lowest min-h-0">
          <div className="p-3 border-b border-outline-variant/10 flex justify-between items-center h-12 shrink-0">
            <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px]">edit_note</span> Scratchpad
            </h3>
            <button onClick={generatePractice} className="bg-tertiary/20 text-tertiary hover:bg-tertiary/30 px-3 py-1 flex items-center gap-1 text-xs font-bold rounded-full transition-colors">
              <span className="material-symbols-outlined text-[14px]">quiz</span> Generate Arena MCQs
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {scratchpadNotes.length === 0 ? (
              <div className="text-sm font-mono text-on-surface/50 text-center mt-10">Saved answers and personal notes will appear here...</div>
            ) : (
              scratchpadNotes.map((note, idx) => (
                <div key={idx} className="bg-surface-container p-4 rounded-xl shadow-sm border border-outline-variant/10">
                  <div className="prose prose-sm prose-invert max-w-none prose-p:leading-relaxed">
                    <ReactMarkdown>{note.text}</ReactMarkdown>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
