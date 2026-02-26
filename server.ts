import express from 'express';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import { createServer as createViteServer } from 'vite';
import { Pool } from 'pg';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

const upload = multer({ storage: multer.memoryStorage() });

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://pdfuser:pdfuser@localhost:5432/pdfagent'
});

// Initialize DB
async function initDB() {
  try {
    // Test connection first
    const client = await pool.connect();
    console.log('Successfully connected to PostgreSQL database.');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS pdf_chunks (
        id SERIAL PRIMARY KEY,
        filename TEXT,
        chunk_index INTEGER,
        page_number INTEGER,
        text TEXT,
        embedding JSONB
      );
    `);
    
    // Add page_number column if it doesn't exist (for existing tables)
    try {
      await client.query(`ALTER TABLE pdf_chunks ADD COLUMN page_number INTEGER;`);
    } catch (e) {
      // Column might already exist, ignore
    }
    
    console.log('Table pdf_chunks ensured to exist.');
    client.release();
  } catch (error: any) {
    console.error('CRITICAL: Failed to connect or initialize database.');
    console.error('Error details:', error.message);
    console.error('Please ensure PostgreSQL is running, the user "pdfuser" exists with password "pdfuser", and the database "pdfagent" is created.');
  }
}

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

// Helper: Text Chunker with Page Number
function chunkTextWithPage(text: string, pageNum: number, chunkSize = 1000, overlap = 200) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push({
      text: text.slice(i, i + chunkSize),
      pageNum
    });
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
    let errorMsg = response.statusText;
    try {
      const errorData = await response.json();
      if (errorData.error) errorMsg = errorData.error;
    } catch (e) {
      // Ignore JSON parse error
    }
    throw new Error(`Ollama embedding error: ${errorMsg}. Certifique-se de que o modelo '${model}' está instalado (rode 'ollama pull ${model}').`);
  }
  
  const data = await response.json();
  return data.embedding;
}

// Start server and initialize DB
async function startServer() {
  await initDB();
  
  // API: Upload PDF and Index
  app.post('/api/upload', upload.single('file'), async (req, res) => {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
      if (!req.file) {
        res.write(JSON.stringify({ status: 'error', error: 'No file uploaded' }) + '\n');
        return res.end();
      }

      const { ollamaUrl, embeddingModel } = req.body;
      
      if (!ollamaUrl || !embeddingModel) {
        res.write(JSON.stringify({ status: 'error', error: 'Ollama URL and Embedding Model are required for indexing with Ollama.' }) + '\n');
        return res.end();
      }

      res.write(JSON.stringify({ status: 'parsing', message: 'Extracting text from PDF...' }) + '\n');

      // Extract text from PDF
      const parser = new PDFParse({ data: req.file.buffer });
      const pdfData = await parser.getText();

      // Chunk text per page
      const allChunks: { text: string, pageNum: number }[] = [];
      if (pdfData.pages && Array.isArray(pdfData.pages)) {
        for (const page of pdfData.pages) {
          const pageChunks = chunkTextWithPage(page.text, page.num);
          allChunks.push(...pageChunks);
        }
      } else {
        // Fallback if pages array is not available
        allChunks.push(...chunkTextWithPage(pdfData.text, 1));
      }

      // Clear previous vector store for simplicity (1 document at a time)
      await pool.query('TRUNCATE TABLE pdf_chunks');

      let indexedCount = 0;
      const totalChunks = allChunks.length;

      if (totalChunks === 0) {
        res.write(JSON.stringify({ status: 'complete', message: 'No text found in PDF.' }) + '\n');
        return res.end();
      }

      // Generate embeddings and store
      for (let i = 0; i < totalChunks; i++) {
        const chunkObj = allChunks[i];
        if (chunkObj.text.trim().length > 0) {
          const embedding = await getOllamaEmbedding(chunkObj.text, ollamaUrl, embeddingModel);
          
          await pool.query(
            'INSERT INTO pdf_chunks (filename, chunk_index, page_number, text, embedding) VALUES ($1, $2, $3, $4, $5)',
            [req.file.originalname, i, chunkObj.pageNum, chunkObj.text, JSON.stringify(embedding)]
          );
          indexedCount++;
        }
        
        const progress = Math.round(((i + 1) / totalChunks) * 100);
        res.write(JSON.stringify({ status: 'progress', progress, current: i + 1, total: totalChunks }) + '\n');
      }

      res.write(JSON.stringify({ status: 'complete', message: `Indexed ${indexedCount} chunks successfully.` }) + '\n');
      res.end();
    } catch (error: any) {
      console.error('Upload Error:', error);
      res.write(JSON.stringify({ status: 'error', error: error.message || 'Failed to process PDF' }) + '\n');
      res.end();
    }
  });

  // API: Chat with RAG
  app.post('/api/chat', async (req, res) => {
    try {
      const { message, history, ollamaUrl, chatModel, embeddingModel } = req.body;

      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      let context = '';

      // Fetch indexed documents from database
      const { rows } = await pool.query('SELECT text, page_number, embedding FROM pdf_chunks');

      // If we have indexed documents, perform vector search
      if (rows.length > 0) {
        if (!ollamaUrl || !embeddingModel) {
          return res.status(400).json({ error: 'Ollama URL and Embedding Model are required.' });
        }
        
        const queryEmbedding = await getOllamaEmbedding(message, ollamaUrl, embeddingModel);
        
        // Calculate similarities
        const scoredChunks = rows.map(doc => ({
          text: doc.text,
          pageNum: doc.page_number,
          score: cosineSimilarity(queryEmbedding, doc.embedding)
        }));

        // Sort by score descending and take top 3
        scoredChunks.sort((a, b) => b.score - a.score);
        const topChunks = scoredChunks.slice(0, 3);
        
        context = topChunks.map(c => `[Página ${c.pageNum}]\n${c.text}`).join('\n\n---\n\n');
      }

      const systemPrompt = `You are a helpful assistant. Use the following context from a PDF document to answer the user's question. Always mention the page number where you found the information (e.g., "Na página X..."). If the answer is not in the context, say "I cannot find the answer in the provided document."\n\nContext:\n${context}`;

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

    } catch (error: any) {
      console.error('Chat Error:', error);
      res.status(500).json({ error: error.message || 'Failed to generate response' });
    }
  });

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
