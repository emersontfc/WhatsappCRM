#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! $1 =~ ^[0-9a-f]{7,40}$ ]]; then
  printf 'Uso: bash release-agentx-vps.sh <commit>\n' >&2
  exit 2
fi

repo=${AGENTX_REPO:-"$HOME/WhatsappCRM"}
repo=$(git -C "$repo" rev-parse --show-toplevel)
commit=$(git -C "$repo" rev-parse --verify "$1^{commit}")
revision=${commit:0:12}
container=agentx-crm
release_image="agentx-release:$revision"
rollback_image="agentx-rollback:$revision-$(date -u +%Y%m%d%H%M%S)-$$"

stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
mkdir "$stage/source"

compose_label() {
  docker inspect --format "{{index .Config.Labels \"com.docker.compose.$1\"}}" "$container"
}

if [[ $(docker inspect --format '{{.State.Running}}' "$container") != true ]]; then
  printf 'O contentor %s precisa estar em execução para preparar a reversão.\n' "$container" >&2
  exit 1
fi

project=$(compose_label project)
project_dir=$(compose_label project.working_dir)
config_files=$(compose_label project.config_files)
service=$(compose_label service)
if [[ -z $project || ! -d $project_dir || -z $config_files || $service != agentx ]]; then
  printf 'Não consegui identificar a configuração Compose ativa do AgentX.\n' >&2
  exit 1
fi

compose=(docker compose --project-name "$project" --project-directory "$project_dir")
# The running container keeps the path to this file in its Compose labels.
state_dir=${AGENTX_RELEASE_STATE_DIR:-"$HOME/.local/state/agentx-release"}
mkdir -p "$state_dir"
override="$state_dir/$project.yml"
IFS=, read -r -a configs <<< "$config_files"
for config in "${configs[@]}"; do
  [[ $config != "$override" ]] || continue
  if [[ ! -r $config ]]; then
    printf 'Ficheiro Compose da instalação indisponível: %s\n' "$config" >&2
    exit 1
  fi
  compose+=(-f "$config")
done
cd "$project_dir"

write_override() {
  printf 'services:\n  agentx:\n    image: %s\n' "$2" > "$1"
}

write_override "$stage/release.yml" "$release_image"
write_override "$stage/rollback.yml" "$rollback_image"
"${compose[@]}" -f "$stage/release.yml" config --quiet
"${compose[@]}" -f "$stage/rollback.yml" config --quiet

git -C "$repo" archive "$commit" | tar -x -C "$stage/source"
printf '\n.env\n.env.*\nuploads\nwhatsapp_sessions_data\n' >> "$stage/source/.dockerignore"

printf 'A preparar a imagem %s com o AgentX em execução.\n' "$revision"
docker build --build-arg "AGENTX_RELEASE=$commit" --label "org.opencontainers.image.revision=$commit" -t "$release_image" "$stage/source"

if [[ -f "$stage/source/scripts/check-agentx-release.ts" ]]; then
  if ! "${compose[@]}" -f "$stage/release.yml" run --rm --no-deps -T --pull never \
    --entrypoint node agentx ./node_modules/tsx/dist/cli.mjs scripts/check-agentx-release.ts; then
    printf 'Publicação abortada antes de trocar a versão em execução.\n' >&2
    exit 1
  fi
fi

old_image=$(docker inspect --format '{{.Image}}' "$container")
if ! docker image tag "$old_image" "$rollback_image" 2>/dev/null; then
  docker commit --pause=false "$container" "$rollback_image" >/dev/null
fi

start_agentx() {
  "${compose[@]}" -f "$override" up -d --no-deps --no-build --pull never --wait --wait-timeout 150 agentx
}

install -m 600 "$stage/release.yml" "$override"
if start_agentx; then
  printf 'AgentX %s publicado. Imagem de reversão: %s\n' "$revision" "$rollback_image"
  exit 0
fi

printf 'A nova versão falhou. A repor a imagem anterior.\n' >&2
docker inspect --format '{{if .State.Health}}{{range .State.Health.Log}}{{println .ExitCode .Output}}{{end}}{{end}}' "$container" >&2 || true
install -m 600 "$stage/rollback.yml" "$override"
if start_agentx; then
  printf 'A versão anterior voltou a responder.\n' >&2
else
  printf 'A reversão não ficou saudável. Imagem anterior: %s\n' "$rollback_image" >&2
fi
exit 1
