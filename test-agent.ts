import "./backend/loadEnv.ts";
import { runAI, encrypt, decrypt } from "./backend/agentManager.ts";

async function testAgent() {
  console.log("--- Agent Engine Test ---");
  
  const mockAgent = {
    provider: "gemini",
    model: "gemini-3-flash-preview",
    instructions: "Você é um assistente de teste. Responda apenas com a palavra 'FUNCIONANDO' se receber esta mensagem.",
    api_key: null // Will use GEMINI_API_KEY from env
  };

  console.log("Testing Gemini (using env key)...");
  try {
    const response = await runAI(mockAgent, "Olá, você está funcionando?", []);
    console.log("Response:", response);
    if (response.includes("FUNCIONANDO") || response.length > 0) {
      console.log("✅ Gemini Test Passed");
    } else {
      console.log("❌ Gemini Test Failed (Empty response)");
    }
  } catch (err: any) {
    console.error("❌ Gemini Test Failed:", err.message);
  }

  // Test Encryption/Decryption
  console.log("\nTesting Encryption...");
  const secret = "sk-test-key-123";
  const encrypted = encrypt(secret);
  const decrypted = decrypt(encrypted);
  if (decrypted === secret) {
    console.log("✅ Encryption/Decryption Passed");
  } else {
    console.log("❌ Encryption/Decryption Failed");
    console.log("Original:", secret);
    console.log("Decrypted:", decrypted);
  }
}

testAgent().catch(console.error);
