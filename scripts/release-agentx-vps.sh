#!/usr/bin/env bash
set -euo pipefail

if [[ ( $# -ne 1 && $# -ne 3 ) || ! ${1:-} =~ ^[0-9a-f]{7,40}$ ]]; then
  printf 'Uso: bash release-agentx-vps.sh <commit> [<url-supabase> <chave-publicavel>]\n' >&2
  exit 2
fi

supabase_url=${2:-}
publishable_key=${3:-}
if [[ $# -eq 3 ]] && [[ ! $supabase_url =~ ^https://[a-z0-9]+\.supabase\.co$ || ! $publishable_key =~ ^sb_publishable_[a-zA-Z0-9_-]+$ ]]; then
  printf 'Verifica o endereço e a chave publicável do novo projeto Supabase.\n' >&2
  exit 2
fi

repo=${AGENTX_REPO:-"$HOME/WhatsappCRM"}
repo=$(git -C "$repo" rev-parse --show-toplevel)
commit=$(git -C "$repo" rev-parse --verify "$1^{commit}")
revision=${commit:0:12}
container=agentx-crm
release_image="agentx-release:$revision"
rollback_image="agentx-rollback:$revision-$(date -u +%Y%m%d%H%M%S)-$$"

stage=$(mktemp -d /tmp/agentx-release.XXXXXXXX)
env_changed=false
release_in_progress=false

replace_env() {
  local pending_env
  pending_env=$(mktemp "$project_dir/.env.agentx.XXXXXXXX") || return 1
  if ! cat "$1" > "$pending_env" || ! mv -fT -- "$pending_env" "$project_dir/.env"; then
    rm -f -- "$pending_env"
    return 1
  fi
}

cleanup() {
  if [[ $release_in_progress == true ]]; then
    rollback_release || true
  elif [[ $env_changed == true ]]; then
    replace_env "$env_backup" || printf 'Repõe a configuração a partir de %s.\n' "$env_backup" >&2
  fi
  rm -rf -- "$stage"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
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
exec {release_lock}>"$state_dir/$project.lock"
if ! flock -n "$release_lock"; then
  printf 'Já está em curso uma publicação do AgentX.\n' >&2
  exit 1
fi
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

preflight="$stage/release.yml"
if [[ -n $supabase_url ]]; then
  if [[ ! -f .env || ! -r .env || -L .env ]]; then
    printf 'O ficheiro .env da instalação está indisponível.\n' >&2
    exit 1
  fi
  # Copy the existing configuration without printing its values or putting the secret in argv.
  set +x
  cp .env "$stage/original.env"
  IFS= read -rs -p 'Cola a chave secreta sb_secret_ do novo Supabase e carrega Enter: ' service_key </dev/tty
  printf '\n' >/dev/tty
  if [[ ! $service_key =~ ^sb_secret_[a-zA-Z0-9_-]+$ ]]; then
    printf 'Usa a chave secreta do novo Supabase que começa por sb_secret_.\n' >&2
    exit 2
  fi
  (
    umask 077
    sed -E '/^[[:blank:]]*(export[[:blank:]]+)?(SUPABASE_URL|VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_KEY)[[:blank:]]*=/d' "$stage/original.env"
    printf '\nSUPABASE_URL=%s\nVITE_SUPABASE_URL=%s\nVITE_SUPABASE_ANON_KEY=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\nSUPABASE_SERVICE_KEY=\n' \
      "$supabase_url" "$supabase_url" "$publishable_key" "$service_key"
  ) > "$stage/supabase.env"
  unset service_key
  chmod 600 "$stage/supabase.env" "$stage/original.env"
  preflight="$stage/preflight.yml"
  cat "$stage/release.yml" > "$preflight"
  printf '    env_file:\n      - %s\n' "$stage/supabase.env" >> "$preflight"
fi

git -C "$repo" archive "$commit" | tar -x -C "$stage/source"
printf '\n.env\n.env.*\nuploads\nwhatsapp_sessions_data\n' >> "$stage/source/.dockerignore"

printf 'A preparar a imagem %s com o AgentX em execução.\n' "$revision"
docker build --build-arg "AGENTX_RELEASE=$commit" --label "org.opencontainers.image.revision=$commit" -t "$release_image" "$stage/source"

if [[ -f "$stage/source/scripts/check-agentx-release.ts" ]]; then
  if ! "${compose[@]}" -f "$preflight" run --rm --no-deps -T --pull never \
    --entrypoint node agentx ./node_modules/tsx/dist/cli.mjs scripts/check-agentx-release.ts; then
    printf 'Publicação abortada antes de trocar a versão em execução.\n' >&2
    exit 1
  fi
elif [[ -n $supabase_url ]]; then
  printf 'Este commit não tem a pré-verificação necessária para trocar de Supabase.\n' >&2
  exit 1
fi

old_image=$(docker inspect --format '{{.Image}}' "$container")
if ! docker image tag "$old_image" "$rollback_image" 2>/dev/null; then
  docker commit --pause=false "$container" "$rollback_image" >/dev/null
fi

start_agentx() {
  "${compose[@]}" -f "$override" up -d --no-deps --no-build --pull never --wait --wait-timeout 150 agentx
}

rollback_release() {
  release_in_progress=false
  printf 'A repor a imagem e configuração anteriores.\n' >&2
  docker inspect --format '{{if .State.Health}}{{range .State.Health.Log}}{{println .ExitCode .Output}}{{end}}{{end}}' "$container" >&2 || true
  if [[ $env_changed == true ]]; then
    if ! replace_env "$env_backup"; then
      printf 'Repõe a configuração a partir de %s.\n' "$env_backup" >&2
      return 1
    fi
    env_changed=false
  fi
  if install -m 600 "$stage/rollback.yml" "$override" && start_agentx; then
    printf 'A versão anterior voltou a responder.\n' >&2
  else
    printf 'A reversão não ficou saudável. Imagem anterior: %s\n' "$rollback_image" >&2
  fi
}

if [[ -n $supabase_url ]]; then
  if ! cmp -s .env "$stage/original.env"; then
    printf 'O .env foi modificado durante a preparação. Volta a executar a publicação.\n' >&2
    exit 1
  fi
  env_backup=$(mktemp "$state_dir/$project.previous-env.XXXXXXXX")
  cat "$stage/original.env" > "$env_backup"
  printf 'Configuração anterior guardada em %s.\n' "$env_backup"
  env_changed=true
  replace_env "$stage/supabase.env"
fi

release_in_progress=true
install -m 600 "$stage/release.yml" "$override"
if start_agentx; then
  release_in_progress=false
  env_changed=false
  printf 'AgentX %s publicado. Imagem de reversão: %s\n' "$revision" "$rollback_image"
  exit 0
fi

printf 'A nova versão falhou.\n' >&2
exit 1
