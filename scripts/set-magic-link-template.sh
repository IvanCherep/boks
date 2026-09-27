#!/usr/bin/env bash
#
# Put the sign-in code into the Magic Link email.
#
# Supabase only prints a code if the template asks for `{{ .Token }}`, and the
# templates are not reachable from the CLI: `supabase config diff` and
# `config pull` do not carry them, and `config push` would send the whole auth
# section - including `pass = "env(RESEND_API_KEY)"`, which clears the SMTP
# password and stops every auth email. So this goes through the Management API,
# which changes the two fields it is given and nothing else.
#
# The token is typed into this script, never into a chat and never into a file.
# Make one at https://supabase.com/dashboard/account/tokens (any name, it can be
# revoked straight afterwards).
#
#   bash scripts/set-magic-link-template.sh
#
# Afterwards the sign-in email carries both: the link, and a six-digit code for
# the contexts the link cannot reach. See docs/hosting.md.

set -euo pipefail

PROJECT_REF="vcmrvnihbptostnzaean"
API="https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth"

read -r -s -p "Supabase personal access token (input hidden): " TOKEN
echo
if [ -z "${TOKEN}" ]; then
  echo "No token given, nothing changed." >&2
  exit 1
fi

SUBJECT="Ваш код для входа в boks"
read -r -d '' CONTENT <<'HTML' || true
<h2>Вход в boks</h2>
<p>Ваш код:</p>
<p style="font-size:30px;letter-spacing:8px;font-weight:700">{{ .Token }}</p>
<p>Или просто откройте ссылку: <a href="{{ .ConfirmationURL }}">Войти в boks</a></p>
<p style="color:#666">Код действует один час. Если вы не запрашивали вход — письмо можно не читать.</p>
HTML

BODY=$(SUBJECT="$SUBJECT" CONTENT="$CONTENT" python3 - <<'PY'
import json, os
print(json.dumps({
    "mailer_subjects_magic_link": os.environ["SUBJECT"],
    "mailer_templates_magic_link_content": os.environ["CONTENT"],
    # Six digits is Supabase's default and what the app's input expects.
    "mailer_otp_length": 6,
}))
PY
)

echo "Updating the Magic Link template and setting the code to 6 digits…"
HTTP=$(curl -sS -o /tmp/boks-auth-config.json -w "%{http_code}" -X PATCH "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$BODY")

if [ "$HTTP" != "200" ]; then
  echo "Failed (HTTP $HTTP). Nothing else was touched. Response:" >&2
  head -c 600 /tmp/boks-auth-config.json >&2; echo >&2
  rm -f /tmp/boks-auth-config.json
  exit 1
fi

echo "Done. What the project now has:"
python3 - <<'PY'
import json
c = json.load(open("/tmp/boks-auth-config.json"))
tpl = c.get("mailer_templates_magic_link_content") or ""
print("  OTP length      :", c.get("mailer_otp_length"))
print("  Subject         :", c.get("mailer_subjects_magic_link"))
print("  Template has code:", "yes" if "{{ .Token }}" in tpl else "NO - check the dashboard")
print("  SMTP still set  :", "yes" if c.get("smtp_host") else "NO - tell Claude before anyone tries to sign in")
PY
rm -f /tmp/boks-auth-config.json

echo
echo "Revoke the token now if you like: https://supabase.com/dashboard/account/tokens"
echo "Then tell Claude it is done - the code entry screen is written and waiting to be deployed."
