#!/bin/sh
set -eu

# Keep Node ahead of MSYS PATH truncation and bypass .cmd argument reparsing
case "$(uname -s)" in
  CYGWIN* | MINGW* | MSYS*)
    node_path="$(command -v node)"
    node_dir="${node_path%/*}"
    npm_path="$(command -v npm)"
    npm_cli="${npm_path%/*}/node_modules/npm/bin/npm-cli.js"
    PATH="${node_dir}:${PATH}"
    export PATH
    exec "${node_path}.exe" "$npm_cli" "$@"
    ;;
esac

exec npm "$@"
