import { robustParseAgentJSON } from "../backend/agentManager.ts";

const sampleToolWithMultilineArgs = `\`\`\`json
{
  "reply": "Agendando mensagem para o cliente agora:",
  "tool": "schedule_message",
  "args": {
    "recipient": "848858288",
    "message": "Olá!
Aqui está sua proposta.
Qualquer dúvida me avise!",
    "scheduledDate": "2026-09-05T10:00:00Z"
  }
}
\`\`\``;

console.log("Parsed sampleToolWithMultilineArgs:", robustParseAgentJSON(sampleToolWithMultilineArgs));
