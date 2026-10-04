import { GoogleGenAI } from '@google/genai';
import type { Category } from '../types';

export async function analyzeImage(file: File): Promise<{ category: Category | null, isValid: boolean, reason: string }> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini API key is missing in .env.local");

  const ai = new GoogleGenAI({ apiKey });

  // Convert the image file to base64 so the AI can read it
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = error => reject(error);
  });

  const prompt = `
    Analyze this image for a civic issue reporting app.
    Is this a valid image of a civic issue (like a pothole, garbage, broken streetlight, leak, or drainage problem)? 
    If it's a selfie, a random meme, a pet, or completely unrelated to civic issues, mark isValid as false.
    
    If valid, categorize it into EXACTLY ONE of these categories: 'Road & pothole', 'Garbage', 'Drainage', 'Streetlight', 'Water leakage', 'Other'.
    
    Respond ONLY with a raw JSON object in this format (no markdown tags, no backticks):
    {
      "isValid": true,
      "category": "Garbage",
      "reason": "Short explanation of what you see"
    }
  `;

  const result = await ai.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: [
      prompt,
      { inlineData: { data: base64Data, mimeType: file.type } }
    ]
  });

  const text = result.text;
  if (!text) throw new Error("Empty AI response");
  
  try {
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanText);
  } catch (e) {
    throw new Error("Failed to parse AI response.");
  }
}