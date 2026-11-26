import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const fresh = new URL("migrations/install_agentx_fresh.sql", root);
const digital = new URL("migrations/apply_agentx_v2.sql", root);
const upgrade = new URL("migrations/apply_agentx_whatsapp_workflows.sql", root);
const teamUpgrade = new URL("migrations/apply_agentx_team_operations.sql", root);

// The fresh-install guard guarantees that none of the conditional v2 tables exist.
// Remove psql directives and combine the migration transactions for the SQL Editor.
function render(file) {
  const name = file.pathname.slice(root.pathname.length);
  const lines = [`-- ${name}`];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const directive = line.trimStart();
    if (line === "BEGIN;" || line === "COMMIT;" || /^SELECT pg_advisory_(lock|unlock)\(/.test(line)) continue;
    if (line === "SET search_path = public, extensions;") {
      lines.push("SET LOCAL search_path = public, extensions;");
      continue;
    }
    if (directive.startsWith("\\ir ")) {
      lines.push(render(new URL(directive.slice(4), file)));
      continue;
    }
    if (file.href === digital.href && (line.endsWith(" \\gset") || /^\\(?:if |endif$)/.test(directive))) continue;
    if (directive === "\\set ON_ERROR_STOP on" || directive.startsWith("\\echo ")) continue;
    if (directive.startsWith("\\")) throw new Error(`Unsupported psql directive in ${name}`);
    lines.push(line);
  }
  return lines.join("\n");
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && !["--whatsapp-upgrade", "--team-upgrade"].includes(args[0]))) {
  throw new Error("Usage: node scripts/render-agentx-fresh-sql.mjs [--whatsapp-upgrade|--team-upgrade]");
}
const [target, instruction] = args[0] === "--team-upgrade"
  ? [teamUpgrade, "atualizar um projeto AgentX com a migração 36 e o esquema de empresas v2 aplicados."]
  : args[0] === "--whatsapp-upgrade"
    ? [upgrade, "atualizar um projeto AgentX com a migração 26 aplicada."]
    : [fresh, "executar apenas num projeto Supabase vazio."];
process.stdout.write(`-- AgentX | ${instruction}\nBEGIN;\nSELECT pg_advisory_xact_lock(879621, 3);\n${render(target)}\nCOMMIT;\n`);
