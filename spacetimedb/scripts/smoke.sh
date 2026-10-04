#!/usr/bin/env bash
# Calls every reducer via `spacetime call` and asserts rows via `spacetime sql`.
# Publishes a throwaway database (default sprout-smoke, data wiped) so it never touches the real one.
#   bash scripts/smoke.sh [--server local] [--db sprout-smoke] [--no-publish] [--slow]
# --slow also waits ~3.5 min to check claim expiry and the offline sweep.
set -uo pipefail

SERVER=local
DB=sprout-smoke
PUBLISH=1
SLOW=0
while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="$2"; shift 2 ;;
    --db) DB="$2"; shift 2 ;;
    --no-publish) PUBLISH=0; shift ;;
    --slow) SLOW=1; shift ;;
    *) echo "unknown flag $1"; exit 2 ;;
  esac
done

MODULE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
OUT=""

if [ "$PUBLISH" = 1 ]; then
  spacetime publish "$DB" --server "$SERVER" -p "$MODULE_DIR" --delete-data -y >/dev/null 2>&1 \
    || { echo "publish failed"; spacetime publish "$DB" --server "$SERVER" -p "$MODULE_DIR" --delete-data -y; exit 1; }
fi

# Run CLI from a neutral dir so no spacetime.json overrides the db name.
cd "${TMPDIR:-/tmp}"

ok()   { PASS=$((PASS + 1)); printf '  \033[32mok\033[0m   %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '       %s\n' "$2"; }

# call <reducer> <args...>: must succeed
call() {
  local r="$1"; shift
  if OUT=$(spacetime call --server "$SERVER" "$DB" "$r" "$@" 2>&1); then return 0; fi
  bad "call $r $*" "$(echo "$OUT" | grep -v WARN | head -2 | tr '\n' ' ')"
  return 1
}
# reject <label> <expected-substring> <reducer> <args...>: must fail with that text
reject() {
  local label="$1" want="$2" r="$3"; shift 3
  if OUT=$(spacetime call --server "$SERVER" "$DB" "$r" "$@" 2>&1); then
    bad "$label (call succeeded, expected rejection)"
  elif echo "$OUT" | grep -qF -- "$want"; then
    ok "$label"
  else
    bad "$label" "wanted \"$want\", got: $(echo "$OUT" | grep 'Response text' | head -1)"
  fi
}
# val <sql>: first cell of the first row, unquoted
val() {
  spacetime sql --server "$SERVER" "$DB" "$1" 2>/dev/null | grep -v WARN | sed -n '3p' | awk -F'|' '{print $1}' \
    | sed -e 's/^ *//' -e 's/ *$//' -e 's/^"//' -e 's/"$//'
}
# eq <label> <sql> <expected>
eq() {
  local got; got=$(val "$2")
  if [ "$got" = "$3" ]; then ok "$1"; else bad "$1" "sql: $2 → got \"$got\", want \"$3\""; fi
}
# has <label> <sql> <substring>: some row of the result contains the substring
has() {
  if spacetime sql --server "$SERVER" "$DB" "$2" 2>/dev/null | grep -qF -- "$3"; then ok "$1"
  else bad "$1" "sql: $2 has no \"$3\""; fi
}
count() { val "SELECT COUNT(*) AS n FROM $1"; }
NONE='{"none":[]}'
some() { printf '{"some":%s}' "$1"; }

echo "== smoke against $SERVER/$DB"

echo "-- config"
eq "claimMode seeded"       "SELECT value FROM config WHERE key = 'claimMode'" warn
eq "claimTtlMinutes seeded" "SELECT value FROM config WHERE key = 'claimTtlMinutes'" 30
eq "requireReview seeded"   "SELECT value FROM config WHERE key = 'requireReview'" false
call set_config '"claimMode"' '"block"' && eq "setConfig claimMode=block" "SELECT value FROM config WHERE key = 'claimMode'" block
reject "setConfig unknown key"  "unknown config key" set_config '"colour"' '"x"'
reject "setConfig bad mode"     "bad value"          set_config '"claimMode"' '"maybe"'
reject "setConfig bad ttl"      "bad value"          set_config '"claimTtlMinutes"' '"0"'
call set_config '"claimMode"' '"warn"'

echo "-- members"
call join_member '"alex"' '"#e76f51"'
call join_member '"sam"' '""'
call join_member '"jo"' '""'
call join_member '"trisha"' '""'
eq  "joinMember stores color" "SELECT color FROM member WHERE handle = 'alex'" '#e76f51'
eq  "joinMember picks a color" "SELECT COUNT(*) AS n FROM member WHERE handle = 'sam' AND color = '#2a9d8f'" 1
call join_member '"alex"' '""' && eq "rejoin keeps color" "SELECT color FROM member WHERE handle = 'alex'" '#e76f51'
reject "empty handle rejected" "handle is required" join_member '""' '""'
reject "bad color rejected"    "color must"         join_member '"zed"' '"red"'
call heartbeat '"alex"' && eq "heartbeat → online" "SELECT online FROM member WHERE handle = 'alex'" true
call set_paused '"jo"' true && eq "setPaused" "SELECT paused FROM member WHERE handle = 'jo'" true

echo "-- seedRepo"
call seed_repo '[{"path":"src/api/routes.ts","lines":120},{"path":"src/api/auth.ts","lines":80},{"path":"src/db.ts","lines":60},{"path":"tests/api.test.ts","lines":90},{"path":"README.md","lines":20},{"path":"empty.txt","lines":0},{"path":"../evil","lines":1}]'
eq "bed = first segment"      "SELECT bed FROM plant WHERE path = 'src/api/routes.ts'" src
eq "bed (root)"               "SELECT bed FROM plant WHERE path = 'README.md'" '(root)'
eq "lines>0 → growing"        "SELECT stage FROM plant WHERE path = 'src/db.ts'" growing
eq "lines=0 → seed"           "SELECT stage FROM plant WHERE path = 'empty.txt'" seed
eq "bad seed path skipped"    "SELECT COUNT(*) AS n FROM plant" 6

echo "-- ingestActivity"
call ingest_activity '"alex"' "$(some '"s-alex"')" '"session_start"' "$NONE" "$NONE" "$NONE" "$NONE"
eq "session_start → idle claude" "SELECT status FROM agent WHERE session_id = 's-alex' AND kind = 'claude'" idle
call ingest_activity '"alex"' "$(some '"s-alex"')" '"prompt"' "$NONE" "$NONE" "$NONE" "$NONE"
eq "prompt → thinking" "SELECT current_action FROM agent WHERE session_id = 's-alex' AND status = 'working'" thinking
call ingest_activity '"alex"' "$(some '"s-alex"')" '"edit"' "$(some '"src/db.ts"')" "$(some 75)" "$(some '"Edit"')" "$NONE"
eq "edit → agent currentPath" "SELECT current_path FROM agent WHERE session_id = 's-alex'" '(some = "src/db.ts")'
eq "edit → plant lines"       "SELECT lines FROM plant WHERE path = 'src/db.ts'" 75
eq "edit → lastTouchedBy"     "SELECT last_touched_by FROM plant WHERE path = 'src/db.ts'" '(some = "alex")'
call ingest_activity '"alex"' "$(some '"s-alex"')" '"create"' "$(some '"src/new.ts"')" "$(some 5)" "$NONE" "$NONE"
eq "create → seed"            "SELECT stage FROM plant WHERE path = 'src/new.ts'" seed
call ingest_activity '"alex"' "$(some '"s-alex"')" '"read"' "$(some '"src/new.ts"')" "$NONE" "$NONE" "$NONE"
eq "next activity → sprout"   "SELECT stage FROM plant WHERE path = 'src/new.ts'" sprout
call ingest_activity '"alex"' "$(some '"s-alex"')" '"edit"' "$(some '"empty.txt"')" "$(some 3)" "$NONE" "$NONE"
eq "edit seed → growing"      "SELECT stage FROM plant WHERE path = 'empty.txt'" growing
call ingest_activity '"alex"' "$(some '"s-alex"')" '"delete"' "$(some '"empty.txt"')" "$NONE" "$NONE" "$NONE"
eq "delete removes plant"     "SELECT COUNT(*) AS n FROM plant WHERE path = 'empty.txt'" 0
call ingest_activity '"alex"' "$(some '"sub-1"')" '"subagent_start"' "$NONE" "$NONE" "$(some '"Explore"')" "$(some '"s-alex"')"
eq "subagent_start"           "SELECT parent_session_id FROM agent WHERE session_id = 'sub-1' AND kind = 'subagent'" '(some = "s-alex")'
call ingest_activity '"alex"' "$(some '"sub-1"')" '"subagent_stop"' "$NONE" "$NONE" "$NONE" "$NONE"
eq "subagent_stop → dormant"  "SELECT status FROM agent WHERE session_id = 'sub-1'" dormant
call ingest_activity '"alex"' "$(some '"s-alex"')" '"waiting"' "$NONE" "$NONE" "$NONE" "$NONE"
eq "waiting"                  "SELECT status FROM agent WHERE session_id = 's-alex'" waiting
call ingest_activity '"alex"' "$(some '"s-alex"')" '"blocked_edit"' "$(some '"src/api/auth.ts"')" "$NONE" "$NONE" "$NONE"
eq "blocked_edit → blocked"   "SELECT status FROM agent WHERE session_id = 's-alex'" blocked
call ingest_activity '"alex"' "$(some '"s-alex"')" '"idle"' "$NONE" "$NONE" "$NONE" "$NONE"
eq "idle"                     "SELECT status FROM agent WHERE session_id = 's-alex'" idle
call ingest_activity '"sam"' "$(some '"s-sam"')" '"session_end"' "$NONE" "$NONE" "$NONE" "$NONE"
eq "session_end → dormant"    "SELECT status FROM agent WHERE session_id = 's-sam'" dormant
LONG=$(printf 'x%.0s' $(seq 1 200))
call ingest_activity '"sam"' "$NONE" '"shell_cmd"' "$NONE" "$NONE" "$(some "\"$LONG\"")" "$NONE"
eq "detail capped at 160"     "SELECT COUNT(*) AS n FROM activity WHERE detail = '$(printf 'x%.0s' $(seq 1 160))'" 1
N=$(count activity)
call ingest_activity '"jo"' "$(some '"s-jo"')" '"edit"' "$(some '"src/db.ts"')" "$NONE" "$NONE" "$NONE"
eq "paused member dropped"    "SELECT COUNT(*) AS n FROM activity" "$N"
reject "server-only kind rejected" "server-only"     ingest_activity '"alex"' "$NONE" '"certify_bloom"' "$NONE" "$NONE" "$NONE" "$NONE"
reject "'..' path rejected"        'must not contain' ingest_activity '"alex"' "$NONE" '"edit"' "$(some '"src/../x"')" "$NONE" "$NONE" "$NONE"
call ingest_activity '"alex"' "$NONE" '"read"' "$(some '"docs/notes..md"')" "$NONE" "$NONE" "$NONE" && ok "'..' inside a filename allowed"
reject "absolute path rejected"    'relative'         ingest_activity '"alex"' "$NONE" '"edit"' "$(some '"/etc/passwd"')" "$NONE" "$NONE" "$NONE"
call report_status '"alex"' "$NONE" '"needs_review"'
eq "reportStatus (all live agents)" "SELECT status FROM agent WHERE session_id = 's-alex'" needs_review
call report_status '"trisha"' "$NONE" '"working"'
eq "reportStatus creates mcp agent" "SELECT status FROM agent WHERE session_id = 'trisha:mcp'" working
reject "reportStatus bad status" "status must be" report_status '"alex"' "$NONE" '"sleepy"'

echo "-- claims"
call claim_files '"alex"' '["src/api/"]' "$NONE"
eq  "claim inserted"           "SELECT handle FROM claim WHERE path = 'src/api/'" alex
has "claim activity"           "SELECT detail FROM activity WHERE kind = 'claim'" "claimed src/api/ for 30 min"
reject "file under dir claim"  "fenced by alex"  claim_files '"sam"' '["src/api/routes.ts"]' "$NONE"
reject "parent dir overlaps"   "fenced by alex"  claim_files '"sam"' '["src/"]' "$NONE"
reject "error says until when" "m (in 30 min)" claim_files '"sam"' '["src/api/auth.ts"]' "$NONE"
call claim_files '"sam"' '["src/db.ts"]' "$(some 5)" && ok "non-overlapping claim ok"
call claim_files '"alex"' '["src/api/"]' "$(some 45)"
eq  "re-claim refreshes, no dup" "SELECT COUNT(*) AS n FROM claim WHERE path = 'src/api/'" 1
reject "empty claim rejected"  "at least one path" claim_files '"alex"' '[]' "$NONE"
call release_files '"alex"' '["src/api/"]'
eq  "releaseFiles"             "SELECT COUNT(*) AS n FROM claim WHERE handle = 'alex'" 0
has "release activity"         "SELECT detail FROM activity WHERE kind = 'release'" "released src/api/ (released)"
call claim_files '"sam"' '["src/api/routes.ts"]' "$NONE" && ok "claim free after release"
call release_files '"sam"' '[]'
eq  "release all (empty paths)" "SELECT COUNT(*) AS n FROM claim WHERE handle = 'sam'" 0

echo "-- messages"
call post_message '"alex"' "$(some '"s-alex"')" '"sam"' '"finding"' '"  routes.ts now returns 404 on missing ids  "'
eq  "postMessage sent (trimmed)" "SELECT body FROM message WHERE from_handle = 'alex' AND status = 'sent'" 'routes.ts now returns 404 on missing ids'
has "message_sent activity"      "SELECT detail FROM activity WHERE kind = 'message_sent'" "→ sam (finding)"
MID=$(val "SELECT id FROM message WHERE from_handle = 'alex' AND to_handle = 'sam'")
reject "markDelivered sender-only"  "only sam can" mark_delivered '"alex"' "$MID"
call mark_delivered '"sam"' "$MID"
eq  "markDelivered"                 "SELECT status FROM message WHERE id = $MID" delivered
has "message_delivered activity"    "SELECT detail FROM activity WHERE kind = 'message_delivered'" "#$MID from alex"
reject "ackMessage recipient-only"  "only sam can" ack_message '"alex"' "$MID"
call ack_message '"sam"' "$MID"
eq  "ackMessage"                    "SELECT status FROM message WHERE id = $MID" acked
eq  "message_acked activity"        "SELECT COUNT(*) AS n FROM activity WHERE kind = 'message_acked'" 1
call mark_delivered '"sam"' "$MID"
eq  "markDelivered after ack is a no-op" "SELECT status FROM message WHERE id = $MID" acked
reject "unknown recipient"  'no teammate named "nobody"' post_message '"alex"' "$NONE" '"nobody"' '"finding"' '"hi"'
reject "empty body"         "empty"                      post_message '"alex"' "$NONE" '"sam"' '"finding"' '"   "'
reject "bad kind"           "message kind"               post_message '"alex"' "$NONE" '"sam"' '"gossip"' '"hi"'
BIG="$(printf 'A%.0s' $(seq 1 495))ZZZZZZZZZZ"
call post_message '"trisha"' "$NONE" '"sam"' '"finding"' "\"$BIG\""
eq  "body capped at 500" "SELECT COUNT(*) AS n FROM message WHERE body = '$(printf 'A%.0s' $(seq 1 495))ZZZZZ'" 1

echo "-- handoffs"
call offer_handoff '"alex"' '"sam"' '"finish auth tests"' '"routes done; auth.test.ts half written"'
HID=$(val "SELECT id FROM handoff WHERE from_handle = 'alex' AND status = 'offered'")
eq  "handoff offered"          "SELECT to_handle FROM handoff WHERE id = $HID" sam
has "handoff message to receiver" "SELECT body FROM message WHERE kind = 'handoff' AND to_handle = 'sam'" "Handoff #$HID: finish auth tests"
eq  "handoff_offered activity" "SELECT COUNT(*) AS n FROM activity WHERE kind = 'handoff_offered'" 1
reject "respond receiver-only" "only sam can" respond_handoff '"alex"' "$HID" true
call respond_handoff '"sam"' "$HID" false
eq  "decline"                  "SELECT status FROM handoff WHERE id = $HID" declined
has "decline → system msg to sender" "SELECT body FROM message WHERE kind = 'system' AND to_handle = 'alex'" "sam declined handoff #$HID"
reject "respond twice"         "already declined" respond_handoff '"sam"' "$HID" true
reject "handoff to self"       "yourself" offer_handoff '"alex"' '"alex"' '"x"' '""'
call offer_handoff '"alex"' '"trisha"' '"review db.ts"' '""'
HID2=$(val "SELECT id FROM handoff WHERE to_handle = 'trisha'")
call respond_handoff '"trisha"' "$HID2" true
eq  "accept"                   "SELECT status FROM handoff WHERE id = $HID2" accepted
eq  "handoff_accepted activity" "SELECT COUNT(*) AS n FROM activity WHERE kind = 'handoff_accepted'" 1

echo "-- tests, diffs, botanist"
P=src/api/routes.ts
call submit_evidence '"alex"' "\"$P\"" '"fix 404s"'
has "no diff → refused"        "SELECT reason FROM certification WHERE path = '$P' AND result = 'refused'" "no real diff seen"
eq  "certify_refused activity" "SELECT COUNT(*) AS n FROM activity WHERE kind = 'certify_refused'" 1
call claim_files '"alex"' "[\"$P\"]" "$NONE"
call record_diff '"alex"' "[\"$P\"]" "$NONE"
eq  "diff → bud"               "SELECT stage FROM plant WHERE path = '$P'" bud
eq  "diff row"                 "SELECT COUNT(*) AS n FROM diff WHERE path = '$P'" 1
call submit_evidence '"alex"' "\"$P\"" '"fix 404s"'
has "diff, no test → refused"  "SELECT reason FROM certification WHERE path = '$P'" "no passing test run seen after your last edit"
eq  "refused plant stays bud"  "SELECT stage FROM plant WHERE path = '$P'" bud
call record_test_run '"alex"' '"mhacks"' '"npm test"' 1
eq  "fail → bugs 1"            "SELECT bugs FROM plant WHERE path = '$P'" 1
eq  "test_fail activity"       "SELECT COUNT(*) AS n FROM activity WHERE kind = 'test_fail'" 1
for i in 1 2 3 4 5; do spacetime call --server "$SERVER" "$DB" record_test_run '"alex"' '"mhacks"' '"npm test"' 1 >/dev/null 2>&1; done
eq  "bugs cap 5"               "SELECT bugs FROM plant WHERE path = '$P'" 5
eq  "others' plants untouched" "SELECT bugs FROM plant WHERE path = 'src/api/auth.ts'" 0
call record_test_run '"alex"' '"mhacks"' '"npm test"' 0
eq  "pass → bugs 0"            "SELECT bugs FROM plant WHERE path = '$P'" 0
eq  "test_pass activity"       "SELECT COUNT(*) AS n FROM activity WHERE kind = 'test_pass'" 1
call submit_evidence '"alex"' "\"$P\"" '"fix 404s"'
eq  "evidence → bloom"         "SELECT stage FROM plant WHERE path = '$P'" bloom
eq  "certification bloom"      "SELECT COUNT(*) AS n FROM certification WHERE path = '$P' AND result = 'bloom'" 1
eq  "certify_bloom activity"   "SELECT COUNT(*) AS n FROM activity WHERE kind = 'certify_bloom'" 1
call submit_evidence '"alex"' "\"$P\"" '"again"'
eq  "no new diff → refused"    "SELECT COUNT(*) AS n FROM certification WHERE path = '$P' AND result = 'refused'" 3
call record_diff '"alex"' "[\"$P\"]" "$NONE"
eq  "bloom + diff → bud"       "SELECT stage FROM plant WHERE path = '$P'" bud
call record_diff '"alex"' "[\"$P\",\"src/db.ts\",\"README.md\"]" '{"some":"abc1234def"}'
eq  "commit on pending diff keeps bud" "SELECT stage FROM plant WHERE path = '$P'" bud
# (SQL can't filter option columns, so match on detail; path holds the bed)
eq  "commit rains per bed (src)"    "SELECT COUNT(*) AS n FROM activity WHERE kind = 'commit' AND detail = 'abc1234: 2 files in src'" 1
eq  "commit rains per bed (root)"   "SELECT COUNT(*) AS n FROM activity WHERE kind = 'commit' AND detail = 'abc1234: 1 file in (root)'" 1
eq  "commit auto-releases claims"   "SELECT COUNT(*) AS n FROM claim WHERE handle = 'alex'" 0
has "auto-release activity"         "SELECT detail FROM activity WHERE kind = 'release'" "committed abc1234"
# A commit after passing tests must not move the evidence clock (edit → test → commit → submit).
call record_diff '"alex"' '["src/db.ts"]' "$NONE"
call record_test_run '"alex"' '"mhacks"' '"npm test"' 0
call record_diff '"alex"' '["src/db.ts"]' '{"some":"fff1111aaa"}'
call submit_evidence '"alex"' '"src/db.ts"' '"commit after tests"'
eq  "commit after tests → bloom"      "SELECT stage FROM plant WHERE path = 'src/db.ts'" bloom
call record_diff '"alex"' '["src/db.ts"]' '{"some":"eee2222bbb"}'
eq  "committing certified work keeps bloom" "SELECT stage FROM plant WHERE path = 'src/db.ts'" bloom
call set_config '"requireReview"' '"true"'
call record_test_run '"alex"' '"mhacks"' '"npm test"' 0
call submit_evidence '"alex"' "\"$P\"" '"with review"'
has "requireReview → refused"  "SELECT reason FROM certification WHERE path = '$P' AND task = 'with review'" "no passing teammate review"
call submit_review '"alex"' "\"$P\"" true
call submit_evidence '"alex"' "\"$P\"" '"self review"'
has "own review doesn't count" "SELECT reason FROM certification WHERE path = '$P' AND task = 'self review'" "no passing teammate review"
call submit_review '"sam"' "\"$P\"" true
eq  "review row"               "SELECT COUNT(*) AS n FROM review WHERE path = '$P'" 2
call submit_evidence '"alex"' "\"$P\"" '"reviewed"'
eq  "teammate review → bloom"  "SELECT result FROM certification WHERE path = '$P' AND task = 'reviewed'" bloom
call set_config '"requireReview"' '"false"'
reject "evidence for unknown plant" "no plant" submit_evidence '"alex"' '"nope.ts"' '"x"'

echo "-- removeMember"
call join_member '"ghost"' '""'
call ingest_activity '"ghost"' "$(some '"s-ghost"')" '"edit"' "$(some '"src/ghost.ts"')" "$(some 3)" "$NONE" "$NONE"
call claim_files '"ghost"' '["src/ghost.ts"]' "$NONE"
call post_message '"ghost"' "$NONE" '"sam"' '"finding"' '"boo"'
call post_message '"sam"' "$NONE" '"ghost"' '"finding"' '"hi ghost"'
call offer_handoff '"sam"' '"ghost"' '"haunt"' '""'
N=$(count activity)
call remove_member '"ghost"'
eq "member gone"           "SELECT COUNT(*) AS n FROM member WHERE handle = 'ghost'" 0
eq "agents gone"           "SELECT COUNT(*) AS n FROM agent WHERE handle = 'ghost'" 0
eq "claims gone"           "SELECT COUNT(*) AS n FROM claim WHERE handle = 'ghost'" 0
eq "messages from gone"    "SELECT COUNT(*) AS n FROM message WHERE from_handle = 'ghost'" 0
eq "messages to gone"      "SELECT COUNT(*) AS n FROM message WHERE to_handle = 'ghost'" 0
eq "open handoffs gone"    "SELECT COUNT(*) AS n FROM handoff WHERE to_handle = 'ghost'" 0
eq "plant kept"            "SELECT COUNT(*) AS n FROM plant WHERE path = 'src/ghost.ts'" 1
eq "plant forgets member"  "SELECT last_touched_by FROM plant WHERE path = 'src/ghost.ts'" '(none = ())'
eq "history kept"          "SELECT COUNT(*) AS n FROM activity" "$N"
call remove_member '"ghost"' && ok "removeMember is idempotent"

echo "-- tasks"
call join_member '"tk"' '""'
call seed_repo '[{"path":"tk/a.ts","lines":10},{"path":"tk/b.ts","lines":10}]'
reject "title too long" "longer than 80" start_task '"tk"' "\"$(printf 'x%.0s' $(seq 1 81))\"" '[]'
call start_task '"tk"' '"Build the thing"' '["tk/"]'
eq  "startTask inserts active"        "SELECT status FROM task WHERE handle = 'tk'" active
eq  "bed from first path"             "SELECT bed FROM task WHERE handle = 'tk'" tk
call start_task '"tk"' '"build the THING"' '["tk/a.ts"]'
eq  "same title (any case) reuses"    "SELECT COUNT(*) AS n FROM task WHERE handle = 'tk'" 1
has "paths merged"                    "SELECT paths FROM task WHERE handle = 'tk'" "tk/a.ts"
call set_task_items '"tk"' '[{"text":"Read","state":"completed"},{"text":"Write","state":"in_progress"},{"text":"Test","state":"bogus"}]'
eq  "items inserted"                  "SELECT COUNT(*) AS n FROM task_item" 3
has "unknown state → pending"         "SELECT state FROM task_item WHERE text = 'Test'" pending
call set_task_items '"tk"' '[{"text":"Only","state":"pending"}]'
eq  "items replaced, not appended"    "SELECT COUNT(*) AS n FROM task_item" 1
call ingest_activity '"tk"' "$(some '"s-tk"')" '"blocked_edit"' "$(some '"tk/b.ts"')" "$NONE" "$(some '"fenced by alex until 7:00pm"')" "$NONE"
eq  "block-mode blocked_edit → blocked" "SELECT status FROM task WHERE handle = 'tk'" blocked
has "blocked reason kept"             "SELECT blocked_reason FROM task WHERE handle = 'tk'" "fenced by alex"
call ingest_activity '"tk"' "$(some '"s-tk"')" '"edit"' "$(some '"tk/b.ts"')" "$(some 12)" "$NONE" "$NONE"
eq  "edit lifts a fence block"        "SELECT status FROM task WHERE handle = 'tk'" active
call ingest_activity '"tk"' "$(some '"s-tk"')" '"blocked_edit"' "$(some '"tk/b.ts"')" "$NONE" "$(some '"warned"')" "$NONE"
eq  "warn-mode blocked_edit keeps status" "SELECT status FROM task WHERE handle = 'tk'" active
call report_status '"tk"' "$NONE" '"needs_review"'
eq  "reportStatus moves the task"     "SELECT status FROM task WHERE handle = 'tk'" needs_review
call submit_evidence '"tk"' '"tk/b.ts"' '"t"'
has "refusal becomes a roadblock"     "SELECT blocked_reason FROM task WHERE handle = 'tk'" "Botanist refused"
call record_diff '"tk"' '["tk/b.ts"]' "$NONE"
call record_test_run '"tk"' '"tk/repo"' '"npm test"' 0
call submit_evidence '"tk"' '"tk/b.ts"' '"t"'
eq  "bloom on a dir-claimed file → done" "SELECT status FROM task WHERE handle = 'tk'" done
has "task_done logged"                "SELECT detail FROM activity WHERE kind = 'task_done'" "Build the thing"
call set_task_items '"tk"' '[{"text":"Plan it","state":"in_progress"}]'
eq  "items with no current task create one" "SELECT COUNT(*) AS n FROM task WHERE handle = 'tk'" 2
has "new task titled by in-progress item"   "SELECT title FROM task WHERE status = 'active'" "Plan it"
call remove_member '"tk"'
eq  "removeMember drops tasks"        "SELECT COUNT(*) AS n FROM task WHERE handle = 'tk'" 0
eq  "removeMember drops items"        "SELECT COUNT(*) AS n FROM task_item" 0

if [ "$SLOW" = 1 ]; then
  echo "-- slow: expiry + sweep (~3.5 min)"
  call claim_files '"jo"' '["tests/"]' "$(some 1)"
  sleep 200  # sweep ticks every 60s from publish; needs a tick >120s after the last heartbeat
  eq "expireClaims removed claim" "SELECT COUNT(*) AS n FROM claim WHERE handle = 'jo'" 0
  has "expiry release activity"   "SELECT detail FROM activity WHERE kind = 'release'" "released tests/ (expired)"
  eq "sweep marks offline"        "SELECT online FROM member WHERE handle = 'sam'" false
fi

echo "== $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
