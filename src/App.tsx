import { useState, useRef, FormEvent, useEffect } from 'react';
import Markdown from 'react-markdown';
import { Upload, Send, FileText, Loader2, FileUp, Trash2, Settings, X } from 'lucide-react';

type Message = {
  role: 'user' | 'model';
  text: string;
  isGreeting?: boolean;
};

export default function App() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfDataUri, setPdfDataUri] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaChatModel, setOllamaChatModel] = useState('qwen2.5-coder:7b');
  const [ollamaEmbeddingModel, setOllamaEmbeddingModel] = useState('qwen2.5-coder:7b');

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      alert('Por favor, envie um arquivo PDF.');
      return;
    }

    setPdfFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPdfDataUri(objectUrl);

    // Upload to backend for indexing
    setIsIndexing(true);
    setIndexProgress(0);
    setMessages([{ role: 'model', text: 'Processando e indexando o PDF...', isGreeting: true }]);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('ollamaUrl', ollamaUrl);
      formData.append('embeddingModel', ollamaEmbeddingModel);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Falha ao conectar com o servidor para indexação');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (data.status === 'progress') {
                setIndexProgress(data.progress);
              } else if (data.status === 'error') {
                throw new Error(data.error);
              } else if (data.status === 'complete') {
                setMessages([{ role: 'model', text: 'PDF indexado com sucesso! O que você gostaria de saber sobre ele?', isGreeting: true }]);
              }
            } catch (e: any) {
              if (e.message !== 'Unexpected end of JSON input') {
                console.error('Error parsing stream line:', e);
              }
            }
          }
        }
      }
    } catch (error: any) {
      console.error(error);
      setMessages([{ role: 'model', text: `Erro ao processar PDF: ${error.message}`, isGreeting: true }]);
    } finally {
      setIsIndexing(false);
      setIndexProgress(0);
    }
  };

  const clearPdf = () => {
    if (pdfDataUri) {
      URL.revokeObjectURL(pdfDataUri);
    }
    setPdfFile(null);
    setPdfDataUri(null);
    setMessages([]);
    setInput('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !pdfFile || isIndexing) return;

    const userMessage = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: userMessage }]);
    setIsLoading(true);

    try {
      const history = messages.filter(m => !m.isGreeting).map(m => ({
        role: m.role === 'model' ? 'assistant' : 'user',
        text: m.text
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history,
          ollamaUrl,
          chatModel: ollamaChatModel,
          embeddingModel: ollamaEmbeddingModel
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Falha ao gerar resposta');
      }

      const data = await response.json();

      setMessages((prev) => [
        ...prev,
        { role: 'model', text: data.reply || 'Sem resposta.' },
      ]);
    } catch (error: any) {
      console.error(error);
      setMessages((prev) => [
        ...prev,
        { role: 'model', text: `Desculpe, ocorreu um erro: ${error.message}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans relative">
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 relative">
            <button 
              onClick={() => setShowSettings(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-semibold mb-4 text-slate-800">Configurações</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Ollama URL</label>
                <input 
                  type="text" 
                  value={ollamaUrl} 
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Modelo de Chat (Ollama)</label>
                <input 
                  type="text" 
                  value={ollamaChatModel} 
                  onChange={(e) => setOllamaChatModel(e.target.value)}
                  placeholder="qwen2.5-coder:7b"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Modelo de Embeddings (Ollama)</label>
                <input 
                  type="text" 
                  value={ollamaEmbeddingModel} 
                  onChange={(e) => setOllamaEmbeddingModel(e.target.value)}
                  placeholder="qwen2.5-coder:7b"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Nota: O modelo de embeddings é usado para indexar o PDF.
                </p>
              </div>
            </div>
            
            <div className="mt-6 flex justify-end">
              <button 
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm transition-colors"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="p-5 border-b border-slate-100">
          <h1 className="text-lg font-bold text-slate-900">PDF Agent</h1>
          <p className="text-xs text-slate-400 mt-0.5">Ask your documents anything</p>
        </div>

        <div className="flex-1 p-4">
          {pdfFile && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Current doc</span>
                <button onClick={clearPdf} className="text-xs text-slate-400 hover:text-red-400 transition-colors">
                  Change
                </button>
              </div>
              <p className="text-sm text-slate-700 font-medium truncate" title={pdfFile.name}>{pdfFile.name}</p>
              <span className={`
                inline-flex items-center gap-1 mt-1.5 text-xs px-2 py-0.5 rounded-full font-medium
                ${!isIndexing ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}
              `}>
                <span className={`w-1.5 h-1.5 rounded-full
                  ${!isIndexing ? 'bg-green-500' : 'bg-amber-500 animate-pulse'}`} />
                {!isIndexing ? 'READY' : `PROCESSING ${indexProgress}%`}
              </span>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 text-xs text-slate-400 space-y-3">
          <button 
            onClick={() => setShowSettings(true)} 
            className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors w-full font-medium"
          >
            <Settings className="w-4 h-4" /> Configurações
          </button>
          <div className="pt-3 border-t border-slate-100 space-y-0.5 text-slate-300">
            <p>Running on Ollama + {ollamaChatModel}</p>
            <p>pgvector · Express · React</p>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <main className="flex-1 flex flex-row overflow-hidden">
        {!pdfFile ? (
          <div className="flex flex-col items-center justify-center h-full p-8 w-full">
            <div
              className={`
                w-full max-w-lg border-2 border-dashed rounded-2xl p-12
                flex flex-col items-center gap-4 transition-all duration-200 cursor-pointer
                border-slate-300 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50/40
              `}
              onClick={() => document.getElementById('pdf-input')?.click()}
            >
              <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center">
                <svg className="w-8 h-8 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>

              <div className="text-center">
                <p className="text-lg font-semibold text-slate-700">
                  {isIndexing ? 'Uploading & Indexing…' : 'Drop your PDF here'}
                </p>
                <p className="text-sm text-slate-400 mt-1">or click to browse · max 50 MB</p>
              </div>

              {isIndexing && (
                <div className="w-full bg-slate-200 rounded-full h-1.5 mt-2">
                  <div className="bg-indigo-500 h-1.5 rounded-full animate-pulse w-2/3" />
                </div>
              )}
            </div>
            <input
              id="pdf-input"
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={handleFileUpload}
              disabled={isIndexing}
            />
          </div>
        ) : (
          <>
            {/* PDF Viewer */}
            <div className="flex-1 border-r border-slate-200 bg-slate-100/50 flex flex-col relative">
              {pdfDataUri && (
                <iframe
                  src={`${pdfDataUri}#toolbar=0`}
                  className="w-full h-full border-none"
                  title="PDF Preview"
                />
              )}
            </div>

            {/* Chat Window */}
            <div className="w-[450px] flex flex-col bg-white shrink-0">
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center gap-3 shrink-0">
                <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{pdfFile.name}</p>
                  <p className="text-xs text-slate-400">Ask anything about this document</p>
                </div>
              </div>

              {/* Message list */}
              <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 bg-slate-50/50">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 gap-2">
                    <svg className="w-10 h-10 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p className="text-sm">Start by asking a question about the document.</p>
                  </div>
                )}

                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-5 py-3.5 ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-white border border-slate-200 text-slate-800 shadow-sm'
                      }`}
                    >
                      {msg.role === 'user' ? (
                        <p className="whitespace-pre-wrap text-sm">{msg.text}</p>
                      ) : (
                        <div className="markdown-body text-sm leading-relaxed">
                          <Markdown>{msg.text}</Markdown>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {(isLoading || isIndexing) && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm flex items-center gap-3">
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                      <span className="text-sm text-slate-500 font-medium">
                        {isIndexing ? `Extraindo e indexando texto... ${indexProgress}%` : 'Analisando documento...'}
                      </span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              <div className="border-t border-slate-200 bg-white px-4 py-3 shrink-0">
                <form onSubmit={handleSubmit} className="flex gap-2 items-end">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask a question about the document…"
                    disabled={isLoading || isIndexing}
                    className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all disabled:opacity-50 disabled:bg-slate-50"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || isLoading || isIndexing}
                    className="shrink-0 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Send
                  </button>
                </form>
                <p className="text-xs text-slate-400 mt-1.5 ml-1">Enter to send</p>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
