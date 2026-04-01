import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  Trash2, 
  MessageSquare, 
  Music, 
  Image as ImageIcon, 
  Clock, 
  ChevronRight, 
  ChevronDown, 
  ChevronUp, 
  Copy, 
  Play, 
  Square, 
  Mic, 
  Save, 
  X,
  ArrowRight,
  Eye,
  List as ListIcon,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Card, CardContent } from './ui/Card';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { supabase, getUserId } from '../supabase';
import { toast } from 'sonner';

export type NodeType = 'text' | 'question' | 'audio' | 'image' | 'delay';

export interface Option {
  id: string;
  node_id: string;
  label: string;
  next_node_id: string | null;
}

export interface Node {
  id: string;
  automation_id: string;
  type: NodeType;
  content: string;
  order_index: number;
  options?: Option[];
  delay_seconds?: number;
}

interface FlowBuilderProps {
  automationId: string;
  automationName: string;
  automationKeyword?: string;
  onSave: (nodes: Node[], name: string, keyword: string) => void;
  onCancel: () => void;
}

export const FlowBuilder: React.FC<FlowBuilderProps> = ({ 
  automationId, 
  automationName,
  automationKeyword = '',
  onSave,
  onCancel 
}) => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [name, setName] = useState(automationName);
  const [keyword, setKeyword] = useState(automationKeyword);
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingNodeId, setRecordingNodeId] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNodes();
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [automationId]);

  const fetchNodes = async () => {
    if (automationId === 'new') {
      setNodes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data: nodesData, error: nodesError } = await supabase
        .from('nodes')
        .select('*, options(*)')
        .eq('automation_id', automationId)
        .order('order_index', { ascending: true });

      if (nodesError) {
        if (nodesError.code === 'PGRST116' || nodesError.message.includes('not found')) {
          setNodes([]);
        } else {
          throw nodesError;
        }
      } else {
        setNodes(nodesData || []);
      }
    } catch (err) {
      console.error('Error fetching nodes:', err);
      setNodes([]);
    } finally {
      setLoading(false);
    }
  };

  const addNode = (type: NodeType) => {
    const newNode: Node = {
      id: crypto.randomUUID(),
      automation_id: automationId,
      type,
      content: type === 'delay' ? '2' : '',
      order_index: nodes.length,
      options: type === 'question' ? [{ id: crypto.randomUUID(), node_id: '', label: 'Opção 1', next_node_id: null }] : [],
      delay_seconds: type === 'delay' ? 2 : undefined
    };
    setNodes([...nodes, newNode]);
  };

  const updateNode = (id: string, updates: Partial<Node>) => {
    setNodes(nodes.map(node => node.id === id ? { ...node, ...updates } : node));
  };

  const deleteNode = (id: string) => {
    setNodes(nodes.filter(node => node.id !== id).map((node, index) => ({ ...node, order_index: index })));
  };

  const duplicateNode = (node: Node) => {
    const newNode: Node = {
      ...node,
      id: crypto.randomUUID(),
      order_index: nodes.length,
      options: node.options?.map(opt => ({ ...opt, id: crypto.randomUUID(), node_id: '' }))
    };
    setNodes([...nodes, newNode]);
  };

  const moveNode = (index: number, direction: 'up' | 'down') => {
    const newNodes = [...nodes];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= nodes.length) return;

    [newNodes[index], newNodes[targetIndex]] = [newNodes[targetIndex], newNodes[index]];
    
    // Update order_index
    const updatedNodes = newNodes.map((node, i) => ({ ...node, order_index: i }));
    setNodes(updatedNodes);
  };

  const addOption = (nodeId: string) => {
    setNodes(nodes.map(node => {
      if (node.id === nodeId) {
        const newOptions = [...(node.options || []), { id: crypto.randomUUID(), node_id: nodeId, label: '', next_node_id: null }];
        return { ...node, options: newOptions };
      }
      return node;
    }));
  };

  const updateOption = (nodeId: string, optionId: string, label: string, nextNodeId: string | null) => {
    setNodes(nodes.map(node => {
      if (node.id === nodeId) {
        const newOptions = node.options?.map(opt => opt.id === optionId ? { ...opt, label, next_node_id: nextNodeId } : opt);
        return { ...node, options: newOptions };
      }
      return node;
    }));
  };

  const deleteOption = (nodeId: string, optionId: string) => {
    setNodes(nodes.map(node => {
      if (node.id === nodeId) {
        const newOptions = node.options?.filter(opt => opt.id !== optionId);
        return { ...node, options: newOptions };
      }
      return node;
    }));
  };

  const startRecording = async (nodeId: string) => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast.error('Seu navegador não suporta gravação de áudio.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/ogg; codecs=opus' });
          await uploadAudio(nodeId, audioBlob);
        }
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingNodeId(nodeId);
    } catch (err) {
      console.error('Error starting recording:', err);
      toast.error('Erro ao acessar microfone. Verifique as permissões.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setRecordingNodeId(null);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const uploadAudio = async (nodeId: string, blob: Blob) => {
    setLoading(true);
    try {
      const userId = await getUserId();
      const fileName = `${userId}/${automationId}/${nodeId}-${Date.now()}.ogg`;
      
      const { data, error } = await supabase.storage
        .from('media')
        .upload(fileName, blob);

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('media')
        .getPublicUrl(fileName);

      updateNode(nodeId, { content: publicUrl });
      toast.success('Áudio gravado e enviado!');
    } catch (err: any) {
      console.error('Error uploading audio:', err);
      toast.error('Erro ao enviar áudio.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-50 dark:bg-slate-950 overflow-hidden">
      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 z-[100] bg-white/50 dark:bg-slate-950/50 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
            <p className="text-sm font-bold text-slate-600 dark:text-slate-400">Processando...</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="sticky top-0 z-20 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-3 md:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
          <Button variant="ghost" size="icon" onClick={onCancel} className="rounded-full shrink-0 h-9 w-9">
            <X size={20} />
          </Button>
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <input 
              type="text" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-transparent border-none text-slate-900 dark:text-white font-bold text-sm md:text-base focus:ring-0 p-0 truncate w-full"
              placeholder="Nome da Automação"
            />
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest shrink-0 hidden sm:inline">Gatilho:</span>
              <input 
                type="text" 
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="bg-transparent border-none text-emerald-600 dark:text-emerald-400 font-bold text-[9px] md:text-[10px] focus:ring-0 p-0 truncate w-full"
                placeholder="palavra-chave"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-1.5 md:gap-2 shrink-0">
          <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex">
            <button 
              onClick={() => setViewMode('edit')}
              className={cn(
                "px-3 md:px-4 py-1.5 rounded-lg text-[10px] md:text-xs font-bold transition-all flex items-center gap-1.5",
                viewMode === 'edit' ? "bg-white dark:bg-slate-700 text-emerald-600 shadow-sm" : "text-slate-500"
              )}
            >
              <ListIcon size={14} />
              <span>Lista</span>
            </button>
            <button 
              onClick={() => setViewMode('preview')}
              className={cn(
                "px-3 md:px-4 py-1.5 rounded-lg text-[10px] md:text-xs font-bold transition-all flex items-center gap-1.5",
                viewMode === 'preview' ? "bg-white dark:bg-slate-700 text-emerald-600 shadow-sm" : "text-slate-500"
              )}
            >
              <Eye size={14} />
              <span>Preview</span>
            </button>
          </div>
          <Button onClick={() => onSave(nodes, name, keyword)} className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl px-4 py-2 h-9 md:h-10 font-bold shadow-lg shadow-emerald-500/20">
            <Save size={16} className="mr-2" />
            <span>Salvar</span>
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {viewMode === 'edit' ? (
          <div className="w-full max-w-2xl mx-auto space-y-6 pb-10">
            <AnimatePresence initial={false}>
              {nodes.map((node, index) => (
                <motion.div
                  key={node.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  <Card className="border-slate-200 dark:border-slate-800 overflow-hidden relative group">
                    <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <CardContent className="p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm shrink-0",
                            node.type === 'text' && "bg-blue-500",
                            node.type === 'question' && "bg-purple-500",
                            node.type === 'audio' && "bg-orange-500",
                            node.type === 'image' && "bg-pink-500",
                            node.type === 'delay' && "bg-slate-500"
                          )}>
                            {node.type === 'text' && <MessageSquare size={16} />}
                            {node.type === 'question' && <ChevronRight size={16} />}
                            {node.type === 'audio' && <Music size={16} />}
                            {node.type === 'image' && <ImageIcon size={16} />}
                            {node.type === 'delay' && <Clock size={16} />}
                          </div>
                          <div className="min-w-0">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Passo {index + 1}</span>
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white capitalize truncate">{node.type === 'question' ? 'Pergunta' : node.type}</h4>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 self-end sm:self-auto">
                          <Button variant="ghost" size="icon" onClick={() => moveNode(index, 'up')} disabled={index === 0} className="h-8 w-8 rounded-lg">
                            <ChevronUp size={16} />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => moveNode(index, 'down')} disabled={index === nodes.length - 1} className="h-8 w-8 rounded-lg">
                            <ChevronDown size={16} />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => duplicateNode(node)} className="h-8 w-8 rounded-lg text-slate-400 hover:text-emerald-500">
                            <Copy size={16} />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteNode(node.id)} className="h-8 w-8 rounded-lg text-slate-400 hover:text-red-500">
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </div>

                      {/* Node Content */}
                      <div className="space-y-4">
                        {node.type === 'text' && (
                          <textarea
                            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500/20 outline-none min-h-[80px] resize-none"
                            placeholder="Escreva sua mensagem..."
                            value={node.content}
                            onChange={(e) => updateNode(node.id, { content: e.target.value })}
                          />
                        )}

                        {node.type === 'question' && (
                          <div className="space-y-4">
                            <textarea
                              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20 outline-none min-h-[60px] resize-none"
                              placeholder="Escreva sua pergunta..."
                              value={node.content}
                              onChange={(e) => updateNode(node.id, { content: e.target.value })}
                            />
                            <div className="space-y-2">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Opções de Resposta</p>
                              {node.options?.map((option) => (
                                <div key={option.id} className="flex flex-col gap-2 p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                                  <div className="flex items-center gap-2">
                                    <Input 
                                      placeholder="Texto da opção"
                                      value={option.label}
                                      onChange={(e) => updateOption(node.id, option.id, e.target.value, option.next_node_id)}
                                      className="flex-1 h-9 text-sm"
                                    />
                                    <Button variant="ghost" size="icon" onClick={() => deleteOption(node.id, option.id)} className="h-9 w-9 text-red-500">
                                      <X size={16} />
                                    </Button>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap">Ir para:</span>
                                    <select
                                      className="flex-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                                      value={option.next_node_id || ''}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === 'new') {
                                          const newId = crypto.randomUUID();
                                          const newNode: Node = {
                                            id: newId,
                                            automation_id: automationId,
                                            type: 'text',
                                            content: '',
                                            order_index: nodes.length,
                                            options: []
                                          };
                                          setNodes([...nodes, newNode]);
                                          updateOption(node.id, option.id, option.label, newId);
                                        } else {
                                          updateOption(node.id, option.id, option.label, val || null);
                                        }
                                      }}
                                    >
                                      <option value="">Fim do fluxo</option>
                                      {nodes.filter(n => n.id !== node.id).map((n, i) => (
                                        <option key={n.id} value={n.id}>Passo {i + 1}: {n.type} ({n.content.substring(0, 15)}...)</option>
                                      ))}
                                      <option value="new" className="text-emerald-600 font-bold">+ Criar novo passo</option>
                                    </select>
                                  </div>
                                </div>
                              ))}
                              <Button 
                                variant="outline" 
                                onClick={() => addOption(node.id)}
                                className="w-full border-dashed border-2 py-2 text-xs font-bold text-slate-500 hover:text-emerald-600 hover:border-emerald-600"
                              >
                                <Plus size={14} className="mr-1" />
                                Adicionar Opção
                              </Button>
                            </div>
                          </div>
                        )}

                        {node.type === 'audio' && (
                          <div className="space-y-3">
                            {node.content ? (
                              <div className="bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-xl border border-emerald-100 dark:border-emerald-900/50 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center text-white">
                                    <Play size={16} fill="currentColor" />
                                  </div>
                                  <div>
                                    <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">Áudio Gravado</p>
                                    <p className="text-[10px] text-emerald-600/60 truncate max-w-[150px]">{node.content}</p>
                                  </div>
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => updateNode(node.id, { content: '' })} className="text-red-500">
                                  <Trash2 size={16} />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center justify-center py-6 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50 dark:bg-slate-900/50">
                                {isRecording && recordingNodeId === node.id ? (
                                  <div className="flex flex-col items-center gap-3">
                                    <div className="flex items-center gap-1">
                                      {[1, 2, 3, 4, 5].map(i => (
                                        <motion.div 
                                          key={i}
                                          animate={{ height: [10, 25, 10] }}
                                          transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.1 }}
                                          className="w-1 bg-red-500 rounded-full"
                                        />
                                      ))}
                                    </div>
                                    <Button onClick={stopRecording} className="bg-red-500 hover:bg-red-600 text-white rounded-full w-12 h-12 p-0">
                                      <Square size={20} fill="currentColor" />
                                    </Button>
                                    <p className="text-xs font-bold text-red-500 animate-pulse">Gravando...</p>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-center gap-3">
                                    <Button onClick={() => startRecording(node.id)} className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-full w-12 h-12 p-0 shadow-lg shadow-emerald-500/20">
                                      <Mic size={20} />
                                    </Button>
                                    <p className="text-xs font-bold text-slate-500">Clique para gravar áudio</p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {node.type === 'image' && (
                          <div className="space-y-3">
                            {node.content ? (
                              <div className="relative rounded-xl overflow-hidden group">
                                <img src={node.content} alt="Preview" className="w-full h-40 object-cover" />
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <Button variant="ghost" onClick={() => updateNode(node.id, { content: '' })} className="text-white hover:text-red-500">
                                    <Trash2 size={20} />
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50 dark:bg-slate-900/50">
                                <Button variant="outline" className="rounded-xl border-slate-300 dark:border-slate-700">
                                  <ImageIcon size={20} className="mr-2" />
                                  Upload Imagem
                                </Button>
                                <p className="text-[10px] text-slate-400 mt-2 italic">PNG, JPG ou GIF (Máx 5MB)</p>
                              </div>
                            )}
                          </div>
                        )}

                        {node.type === 'delay' && (
                          <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                            <Clock className="text-slate-400" size={20} />
                            <div className="flex-1">
                              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Tempo de espera</p>
                              <div className="flex items-center gap-2 mt-1">
                                <input 
                                  type="range" 
                                  min="1" 
                                  max="60" 
                                  value={node.delay_seconds || 2}
                                  onChange={(e) => updateNode(node.id, { delay_seconds: parseInt(e.target.value) })}
                                  className="flex-1 accent-emerald-500"
                                />
                                <span className="text-sm font-bold text-emerald-600 w-8">{node.delay_seconds || 2}s</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Connection Indicator */}
                      {index < nodes.length - 1 && (
                        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-center">
                          <div className="flex flex-col items-center">
                            <div className="w-px h-4 bg-slate-200 dark:bg-slate-800" />
                            <div className="bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                              Próximo: Passo {index + 2} <ArrowRight size={10} />
                            </div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Add Step Button */}
            <div className="pt-8">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-4 text-center">Adicionar Próximo Passo</p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { type: 'text', label: 'Texto', icon: MessageSquare, color: 'bg-blue-500' },
                  { type: 'question', label: 'Pergunta', icon: ChevronRight, color: 'bg-purple-500' },
                  { type: 'audio', label: 'Áudio', icon: Music, color: 'bg-orange-500' },
                  { type: 'image', label: 'Imagem', icon: ImageIcon, color: 'bg-pink-500' },
                  { type: 'delay', label: 'Delay', icon: Clock, color: 'bg-slate-500' }
                ].map((item) => (
                  <button
                    key={item.type}
                    onClick={() => addNode(item.type as NodeType)}
                    className="flex flex-col items-center justify-center gap-2 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-all group"
                  >
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm group-hover:scale-110 transition-transform", item.color)}>
                      <item.icon size={20} />
                    </div>
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-400">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Preview Mode - Chat Simulation */
          <div className="max-w-[350px] mx-auto h-[600px] bg-[#E5DDD5] dark:bg-slate-950 rounded-[2.5rem] border-[8px] border-slate-900 dark:border-slate-800 overflow-hidden shadow-2xl relative flex flex-col">
            {/* Phone Header */}
            <div className="bg-[#075E54] dark:bg-slate-900 p-4 pt-8 flex items-center gap-3 text-white">
              <div className="h-8 w-8 rounded-full bg-slate-200/20 flex items-center justify-center">
                <Mic size={16} />
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold">Simulação Bot</p>
                <p className="text-[10px] opacity-70">online</p>
              </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 p-3 space-y-4 overflow-y-auto bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat">
              {nodes.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-2 opacity-50">
                  <AlertCircle size={32} />
                  <p className="text-xs font-bold">Nenhum passo criado</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {nodes.map((node, i) => (
                    <div key={node.id} className="flex justify-end animate-in fade-in slide-in-from-bottom-2 duration-500">
                      <div className="bg-[#DCF8C6] dark:bg-emerald-900/40 p-2 rounded-lg rounded-tr-none shadow-sm max-w-[85%] space-y-2">
                        {node.type === 'image' && node.content && (
                          <img src={node.content} alt="Preview" className="w-full rounded-md" />
                        )}
                        {node.type === 'audio' && node.content && (
                          <div className="flex items-center gap-2 bg-black/5 p-2 rounded-lg">
                            <Play size={16} fill="currentColor" />
                            <div className="flex-1 h-1 bg-slate-300 rounded-full overflow-hidden">
                              <div className="w-1/3 h-full bg-emerald-500" />
                            </div>
                            <span className="text-[8px]">0:12</span>
                          </div>
                        )}
                        {node.type === 'delay' ? (
                          <p className="text-[10px] italic text-slate-500">Aguardando {node.delay_seconds}s...</p>
                        ) : (
                          <p className="text-[11px] text-slate-900 dark:text-slate-100 whitespace-pre-wrap">{node.content || '...'}</p>
                        )}
                        
                        {node.type === 'question' && node.options && node.options.length > 0 && (
                          <div className="space-y-1 pt-2">
                            {node.options.map((opt, j) => (
                              <div key={j} className="bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold py-2 px-3 rounded-md text-center shadow-sm border border-slate-100 dark:border-slate-700">
                                {opt.label || `Opção ${j + 1}`}
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="text-[9px] text-slate-400 text-right">10:01</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Chat Input */}
            <div className="p-2 bg-white dark:bg-slate-900 flex items-center gap-2">
              <div className="flex-1 bg-slate-100 dark:bg-slate-800 h-8 rounded-full px-3 flex items-center text-slate-400 text-[10px]">
                Mensagem
              </div>
              <div className="h-8 w-8 rounded-full bg-[#128C7E] flex items-center justify-center text-white">
                <Play size={14} fill="currentColor" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 md:gap-4 z-30 shrink-0">
        <div className="flex-1 flex items-center gap-2">
          <div className="h-1.5 md:h-2 flex-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-emerald-500 transition-all duration-500" 
              style={{ width: `${Math.min((nodes.length / 10) * 100, 100)}%` }} 
            />
          </div>
          <span className="text-[9px] md:text-[10px] font-bold text-slate-400 whitespace-nowrap">{nodes.length}/10 Passos</span>
        </div>
        <Button 
          onClick={() => onSave(nodes, name, keyword)}
          className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl px-6 md:px-8 py-4 md:py-6 h-auto font-bold shadow-xl shadow-emerald-500/20 text-sm md:text-base"
        >
          Finalizar
        </Button>
      </div>
    </div>
  );
};
