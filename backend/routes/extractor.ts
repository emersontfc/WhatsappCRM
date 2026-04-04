import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenAI } from "@google/genai";
import { authenticate } from "../middleware/auth.ts";

const router = express.Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const EXTRACTION_SYSTEM_PROMPT = `
Você é um agente especializado em EXTRAÇÃO DE DADOS DE PÁGINAS WEB.
Seu objetivo é:
1. Analisar o HTML recebido
2. Identificar automaticamente os dados relevantes
3. Criar regras reutilizáveis (CSS selectors)
4. Retornar os dados estruturados em JSON

FORMATO DE RESPOSTA OBRIGATÓRIO:
{
  "status": "success",
  "data": {
    "titulo": "...",
    "data": "...",
    "conteudo": "...",
    "itens": []
  },
  "selectors": {
    "titulo": "...",
    "data": "...",
    "conteudo": "...",
    "itens": "..."
  },
  "confidence": 0.0-1.0
}

REGRAS:
- Nunca inventar dados.
- Se não encontrar algo, use null.
- Priorizar precisão sobre completude.
`;

router.post("/", authenticate, async (req: any, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL é obrigatória" });

    // 1. Fetch HTML
    const response = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DataExtractor/1.0)" },
    });
    const html = response.data;

    // 2. Use Gemini to extract data
    const prompt = `Analise o seguinte HTML e extraia os dados conforme as regras:\n\n${html.substring(0, 50000)}`; // Limit to 50k chars for token limits

    const aiResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: EXTRACTION_SYSTEM_PROMPT,
        responseMimeType: "application/json",
      },
    });

    const extractedData = JSON.parse(aiResponse.text || "{}");
    res.json(extractedData);
  } catch (error: any) {
    console.error("Extraction error:", error);
    res.status(500).json({ status: "error", error: error.message });
  }
});

export default router;
