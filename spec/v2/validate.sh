#!/usr/bin/env bash
# Validate OpenSRM v2 example manifests against spec/v2/schema.json.
#
# Asserts two things:
#   1. every file under examples/ VALIDATES (positive fixtures);
#   2. every file under tests/invalid/ is REJECTED (negative fixtures) —
#      proving the schema actually catches errors rather than rubber-stamping.
#
# Requires `check-jsonschema` (run via `uvx check-jsonschema` if not installed).
# Usage: bash spec/v2/validate.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
schema="$here/schema.json"

if command -v check-jsonschema >/dev/null 2>&1; then
  cjs=(check-jsonschema)
else
  cjs=(uvx --quiet check-jsonschema)
fi

fail=0

echo "== positive fixtures (must validate) =="
while IFS= read -r f; do
  if "${cjs[@]}" --schemafile "$schema" "$f" >/dev/null 2>&1; then
    echo "  ok      ${f#"$here/"}"
  else
    echo "  FAIL    ${f#"$here/"} (should have validated)"
    fail=1
  fi
done < <(find "$here/examples" -name '*.yaml' | sort)

echo "== negative fixtures (must be rejected) =="
while IFS= read -r f; do
  if "${cjs[@]}" --schemafile "$schema" "$f" >/dev/null 2>&1; then
    echo "  LEAK    ${f#"$here/"} (should have been rejected)"
    fail=1
  else
    echo "  caught  ${f#"$here/"}"
  fi
done < <(find "$here/tests/invalid" -name '*.yaml' | sort)

if [ "$fail" -eq 0 ]; then
  echo "== all v2 schema fixtures behaved as expected =="
else
  echo "== FAILURES above =="
fi
exit "$fail"
