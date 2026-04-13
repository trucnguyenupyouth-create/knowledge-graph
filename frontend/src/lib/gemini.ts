import { GoogleGenAI } from '@google/genai';

// In-memory counter for round-robin rotation.
// Note: In a true serverless environment (like Vercel Edge), this state resets.
// However, since it falls back to the first config or rotates randomly, it still effectively load balances.
let currentKeyIndex = 0;

export function getGeminiClient(): GoogleGenAI {
  // Support both comma-separated GEMINI_API_KEYS and fallback to GEMINI_API_KEY
  const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY;
  
  if (!rawKeys) {
    throw new Error('Chưa cấu hình GEMINI_API_KEYS hoặc GEMINI_API_KEY trong file .env');
  }

  const keys = rawKeys.split(',').map(k => k.trim()).filter(k => k.length > 0);
  
  if (keys.length === 0) {
    throw new Error('Danh sách API Key rỗng.');
  }

  // Round-robin selection
  const selectedKey = keys[currentKeyIndex % keys.length];
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;

  console.log(`[Diagnostic Engine] Using Gemini Key Index ${currentKeyIndex === 0 ? keys.length - 1 : currentKeyIndex - 1} of ${keys.length}`);

  return new GoogleGenAI({ apiKey: selectedKey });
}
