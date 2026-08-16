#!/usr/bin/env bash
set -Eeuo pipefail

deploy_root="${1:?deployment root is required}"
release_sha="${2:?release SHA is required}"
archive_name="${3:?release archive name is required}"

if [[ ! "$deploy_root" =~ ^/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)+$ || "$deploy_root" == *..* ]]; then
  echo "The deployment root must be a specific absolute path with at least two segments and no '..'." >&2
  exit 1
fi

if [[ ! "$release_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "The release SHA is invalid." >&2
  exit 1
fi

if [[ "$archive_name" != "liqwifi-backend-${release_sha}.tar.gz" ]]; then
  echo "The release archive name is invalid." >&2
  exit 1
fi

archive_path="/tmp/${archive_name}"
shared_dir="${deploy_root}/shared"
release_dir="${deploy_root}/releases/${release_sha}"
environment_file="${shared_dir}/.env"

if [[ ! -f "$archive_path" ]]; then
  echo "Release archive not found at ${archive_path}." >&2
  exit 1
fi

if [[ ! -f "$environment_file" ]]; then
  echo "Production environment file not found at ${environment_file}." >&2
  echo "Create it from deploy/.env.example before deploying." >&2
  exit 1
fi

mkdir -p "$release_dir" "$shared_dir"
chmod 600 "$environment_file"
tar -xzf "$archive_path" -C "$release_dir"
ln -sfn "$environment_file" "$release_dir/.env"

cd "$release_dir"
docker compose -f docker-compose.production.yml config --quiet
docker compose -f docker-compose.production.yml build --pull
docker compose -f docker-compose.production.yml up -d redis --wait --wait-timeout 120
docker compose -f docker-compose.production.yml run --rm backend npm run migration:run:prod
docker compose -f docker-compose.production.yml up -d --remove-orphans --wait --wait-timeout 180

ln -sfnT "$release_dir" "$deploy_root/current"
rm -f "$archive_path"

echo "Backend deployment ${release_sha} completed successfully."
