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
        text TEXT,
        embedding JSONB
      );
    `);
    console.log('Table pdf_chunks ensured to exist.');
    client.release();
  } catch (error: any) {
    console.error('CRITICAL: Failed to connect or initialize database.');
    console.error('Error details:', error.message);
    console.error('Please ensure PostgreSQL is running, the user "pdfuser" exists with password "pdfuser", and the database "pdfagent" is created.');
  }
}

// Start server and initialize DB
async function startServer() {
  await initDB();
  
  // API: Upload PDF and Index
  app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { ollamaUrl, embeddingModel } = req.body;
      
      if (!ollamaUrl || !embeddingModel) {
        return res.status(400).json({ error: 'Ollama URL and Embedding Model are required for indexing with Ollama.' });
      }

      // Extract text from PDF
      const parser = new PDFParse({ data: req.file.buffer });
      const pdfData = await parser.getText();
      const rawText = pdfData.text;

      // Chunk text
      const chunks = chunkText(rawText);

      // Clear previous vector store for simplicity (1 document at a time)
      await pool.query('TRUNCATE TABLE pdf_chunks');

      let indexedCount = 0;

      // Generate embeddings and store
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk.trim().length === 0) continue;
        
        const embedding = await getOllamaEmbedding(chunk, ollamaUrl, embeddingModel);
        
        await pool.query(
          'INSERT INTO pdf_chunks (filename, chunk_index, text, embedding) VALUES ($1, $2, $3, $4)',
          [req.file.originalname, i, chunk, JSON.stringify(embedding)]
        );
        indexedCount++;
      }

      res.json({ 
        success: true, 
        message: `Indexed ${indexedCount} chunks successfully.` 
      });
    } catch (error: any) {
      console.error('Upload Error:', error);
      res.status(500).json({ error: error.message || 'Failed to process PDF' });
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
      const { rows } = await pool.query('SELECT text, embedding FROM pdf_chunks');

      // If we have indexed documents, perform vector search
      if (rows.length > 0) {
        if (!ollamaUrl || !embeddingModel) {
          return res.status(400).json({ error: 'Ollama URL and Embedding Model are required.' });
        }
        
        const queryEmbedding = await getOllamaEmbedding(message, ollamaUrl, embeddingModel);
        
        // Calculate similarities
        const scoredChunks = rows.map(doc => ({
          text: doc.text,
          score: cosineSimilarity(queryEmbedding, doc.embedding)
        }));

        // Sort by score descending and take top 3
        scoredChunks.sort((a, b) => b.score - a.score);
        const topChunks = scoredChunks.slice(0, 3);
        
        context = topChunks.map(c => c.text).join('\n\n---\n\n');
      }

      const systemPrompt = `You are a helpful assistant. Use the following context from a PDF document to answer the user's question. If the answer is not in the context, say "I cannot find the answer in the provided document."\n\nContext:\n${context}`;

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
