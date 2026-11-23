import { apiFetch } from "./api";

export async function importContactsCsv(file: File) {
  if (file.size > 1_000_000) throw new Error("Escolhe um CSV de contactos até 1 MB.");
  const result = await apiFetch("/api/contacts/import", {
    method: "POST", body: JSON.stringify({ csv: await file.text() }), timeout: 60000
  });
  if (result?.success !== true || !result.data) throw new Error("A API não confirmou a importação.");
  const { created, updated, duplicates, invalid, limited } = result.data;
  const summary = [`${created} novos`, `${updated} atualizados`];
  if (duplicates) summary.push(`${duplicates} repetidos no ficheiro`);
  if (invalid) summary.push(`${invalid} inválidos`);
  if (limited) summary.push(`${limited} acima do limite`);
  return { message: summary.join(" · "), warning: Boolean(invalid || limited) };
}
