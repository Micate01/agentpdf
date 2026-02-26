import express from 'express';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

const upload = multer({ storage: multer.memoryStorage() });

// Simple In-Memory Vector Store
interface VectorDocument {
  id: string;
  text: string;
  embedding: number[];
}

let vectorStore: VectorDocument[] = [];

// Helper: Cosine Similarity
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Helper: Text Chunker
function chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks;
}

// Helper: Get Embeddings from Ollama
async function getOllamaEmbedding(text: string, ollamaUrl: string, model: string): Promise<number[]> {
  const response = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text }),
  });
  
  if (!response.ok) {
    throw new Error(`Ollama embedding error: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.embedding;
}

// API: Upload PDF and Index
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { ollamaUrl, embeddingModel } = req.body;
    if (!ollamaUrl || !embeddingModel) {
      return res.status(400).json({ error: 'Ollama URL and Embedding Model are required for indexing.' });
    }

    // Extract text from PDF
    const parser = new PDFParse({ data: req.file.buffer });
    const pdfData = await parser.getText();
    const rawText = pdfData.text;

    // Chunk text
    const chunks = chunkText(rawText);

    // Clear previous vector store for simplicity (1 document at a time)
    vectorStore = [];

    // Generate embeddings and store
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk.trim().length === 0) continue;
      
      const embedding = await getOllamaEmbedding(chunk, ollamaUrl, embeddingModel);
      vectorStore.push({
        id: `chunk-${i}`,
        text: chunk,
        embedding
      });
    }

    res.json({ 
      success: true, 
      message: `Indexed ${vectorStore.length} chunks successfully.` 
    });
  } catch (error: any) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: error.message || 'Failed to process PDF' });
  }
});

// API: Chat with RAG
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history, provider, ollamaUrl, chatModel, embeddingModel } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    let context = '';

    // If we have indexed documents, perform vector search
    if (vectorStore.length > 0 && ollamaUrl && embeddingModel) {
      const queryEmbedding = await getOllamaEmbedding(message, ollamaUrl, embeddingModel);
      
      // Calculate similarities
      const scoredChunks = vectorStore.map(doc => ({
        ...doc,
        score: cosineSimilarity(queryEmbedding, doc.embedding)
      }));

      // Sort by score descending and take top 3
      scoredChunks.sort((a, b) => b.score - a.score);
      const topChunks = scoredChunks.slice(0, 3);
      
      context = topChunks.map(c => c.text).join('\n\n---\n\n');
    }

    const systemPrompt = `You are a helpful assistant. Use the following context from a PDF document to answer the user's question. If the answer is not in the context, say "I cannot find the answer in the provided document."\n\nContext:\n${context}`;

    if (provider === 'ollama') {
      if (!ollamaUrl || !chatModel) {
        return res.status(400).json({ error: 'Ollama URL and Chat Model are required.' });
      }

      const ollamaMessages = [
        { role: 'system', content: systemPrompt },
        ...history.map((m: any) => ({ role: m.role, content: m.text })),
        { role: 'user', content: message }
      ];

      const response = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: chatModel,
          messages: ollamaMessages,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama chat error: ${response.statusText}`);
      }

      const data = await response.json();
      res.json({ reply: data.message.content });

    } else {
      // Fallback to Gemini
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const geminiContents = [];
      
      // Add context as the first system-like message
      geminiContents.push({ role: 'user', parts: [{ text: systemPrompt }] });
      geminiContents.push({ role: 'model', parts: [{ text: 'Understood. I will use the provided context to answer your questions.' }] });

      // Add history
      for (const msg of history) {
        geminiContents.push({ role: msg.role, parts: [{ text: msg.text }] });
      }

      // Add current message
      geminiContents.push({ role: 'user', parts: [{ text: message }] });

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: geminiContents,
      });

      res.json({ reply: response.text });
    }

  } catch (error: any) {
    console.error('Chat Error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate response' });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
