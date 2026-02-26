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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [provider, setProvider] = useState<'gemini' | 'ollama'>('gemini');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaChatModel, setOllamaChatModel] = useState('llama3');
  const [ollamaEmbeddingModel, setOllamaEmbeddingModel] = useState('nomic-embed-text');

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
    const reader = new FileReader();
    reader.onload = (event) => {
      setPdfDataUri(event.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload to backend for indexing
    setIsIndexing(true);
    setMessages([{ role: 'model', text: 'Processando e indexando o PDF...', isGreeting: true }]);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('provider', provider);
      formData.append('ollamaUrl', ollamaUrl);
      formData.append('embeddingModel', ollamaEmbeddingModel);
      formData.append('geminiApiKey', process.env.GEMINI_API_KEY || '');

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Falha ao indexar o PDF');
      }

      setMessages([{ role: 'model', text: 'PDF indexado com sucesso! O que você gostaria de saber sobre ele?', isGreeting: true }]);
    } catch (error: any) {
      console.error(error);
      setMessages([{ role: 'model', text: `Erro ao processar PDF: ${error.message}`, isGreeting: true }]);
    } finally {
      setIsIndexing(false);
    }
  };

  const clearPdf = () => {
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
          provider,
          ollamaUrl,
          chatModel: ollamaChatModel,
          embeddingModel: ollamaEmbeddingModel,
          geminiApiKey: process.env.GEMINI_API_KEY
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
    <div className="min-h-screen bg-zinc-50 flex flex-col md:flex-row font-sans relative">
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 relative">
            <button 
              onClick={() => setShowSettings(false)}
              className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-semibold mb-4 text-zinc-800">Configurações</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Provedor LLM</label>
                <select 
                  value={provider} 
                  onChange={(e) => setProvider(e.target.value as 'gemini' | 'ollama')}
                  className="w-full p-2.5 bg-zinc-50 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="gemini">Gemini (Cloud)</option>
                  <option value="ollama">Ollama (Local)</option>
                </select>
              </div>

              {provider === 'ollama' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Ollama URL</label>
                    <input 
                      type="text" 
                      value={ollamaUrl} 
                      onChange={(e) => setOllamaUrl(e.target.value)}
                      placeholder="http://localhost:11434"
                      className="w-full p-2.5 bg-zinc-50 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Modelo de Chat (Ollama)</label>
                    <input 
                      type="text" 
                      value={ollamaChatModel} 
                      onChange={(e) => setOllamaChatModel(e.target.value)}
                      placeholder="llama3"
                      className="w-full p-2.5 bg-zinc-50 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Modelo de Embeddings (Ollama)</label>
                    <input 
                      type="text" 
                      value={ollamaEmbeddingModel} 
                      onChange={(e) => setOllamaEmbeddingModel(e.target.value)}
                      placeholder="nomic-embed-text"
                      className="w-full p-2.5 bg-zinc-50 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <p className="text-xs text-zinc-500 mt-1">
                      Nota: O modelo de embeddings é usado para indexar o PDF.
                    </p>
                  </div>
                </>
              )}
            </div>
            
            <div className="mt-6 flex justify-end">
              <button 
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Left Panel: PDF Preview */}
      <div className="w-full md:w-1/2 h-[50vh] md:h-screen border-b md:border-b-0 md:border-r border-zinc-200 bg-zinc-100 flex flex-col">
        <div className="p-4 bg-white border-b border-zinc-200 flex items-center justify-between shadow-sm z-10">
          <div className="flex items-center gap-2 text-zinc-800 font-medium">
            <FileText className="w-5 h-5 text-indigo-600" />
            <h2>Visualizador de PDF</h2>
          </div>
          <div className="flex items-center gap-2">
            {pdfFile && (
              <button
                onClick={clearPdf}
                className="p-2 text-zinc-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Remover PDF"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        
        <div className="flex-1 overflow-hidden relative flex items-center justify-center bg-zinc-100/50">
          {!pdfDataUri ? (
            <div className="text-center p-8">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm border border-zinc-200">
                <FileUp className="w-8 h-8 text-indigo-500" />
              </div>
              <h3 className="text-lg font-medium text-zinc-900 mb-2">Nenhum PDF selecionado</h3>
              <p className="text-zinc-500 mb-6 max-w-sm mx-auto">
                Faça o upload de um documento PDF para começar a fazer perguntas sobre o seu conteúdo.
              </p>
              <label className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors cursor-pointer font-medium shadow-sm">
                <Upload className="w-4 h-4" />
                Selecionar Arquivo PDF
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          ) : (
            <iframe
              src={`${pdfDataUri}#toolbar=0`}
              className="w-full h-full border-none"
              title="PDF Preview"
            />
          )}
        </div>
      </div>

      {/* Right Panel: Chat Interface */}
      <div className="w-full md:w-1/2 h-[50vh] md:h-screen flex flex-col bg-white">
        <div className="p-4 border-b border-zinc-200 bg-white shadow-sm z-10 flex justify-between items-center">
          <div>
            <h2 className="font-medium text-zinc-800">Chat com o Documento</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {provider === 'gemini' ? 'Powered by Gemini 3.1 Pro' : `Powered by Ollama (${ollamaChatModel})`}
            </p>
          </div>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 text-zinc-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            title="Configurações"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-zinc-50/50">
          {messages.length === 0 && !pdfFile ? (
            <div className="h-full flex items-center justify-center text-zinc-400 text-sm">
              Faça o upload de um PDF primeiro.
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-5 py-3.5 ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-white border border-zinc-200 text-zinc-800 shadow-sm'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                  ) : (
                    <div className="markdown-body text-sm leading-relaxed">
                      <Markdown>{msg.text}</Markdown>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {(isLoading || isIndexing) && (
            <div className="flex justify-start">
              <div className="bg-white border border-zinc-200 rounded-2xl px-5 py-4 shadow-sm flex items-center gap-3">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                <span className="text-sm text-zinc-500 font-medium">
                  {isIndexing ? 'Extraindo e indexando texto...' : 'Analisando documento...'}
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-white border-t border-zinc-200">
          <form onSubmit={handleSubmit} className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={pdfFile ? "Faça uma pergunta sobre o PDF..." : "Faça upload de um PDF primeiro..."}
              disabled={!pdfFile || isLoading || isIndexing}
              className="w-full pl-4 pr-12 py-3.5 bg-zinc-100 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed outline-none"
            />
            <button
              type="submit"
              disabled={!input.trim() || !pdfFile || isLoading || isIndexing}
              className="absolute right-2 p-2 text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-300 disabled:text-zinc-500 rounded-lg transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
