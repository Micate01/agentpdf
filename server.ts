import express from 'express';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
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
