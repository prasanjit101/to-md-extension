#!/bin/sh
# Smoke test: drives content.js in a real browser and asserts the Markdown output.
# Needs agent-browser + python3. Run: ./test.sh
set -e
cd "$(dirname "$0")"

SCRIPT_DIR=$(pwd)
PORT=$(( 8100 + $$ % 800 ))
DIR=$(mktemp -d)
AB="agent-browser --session webtext-test"
FAIL=0

cleanup() {
  { $AB close; kill "$SERVER"; wait "$SERVER"; } >/dev/null 2>&1 || true
  rm -rf "$DIR"
}
trap cleanup EXIT

cat > "$DIR/fixture.html" <<'HTML'
<!doctype html><html><body><div id="root">
<h1>One</h1><h2>Two</h2>
<p>Plain <strong>bold</strong> and <em>italic</em> with a <a href="/x">link</a>.</p>
<ul><li>Top</li><li>Parent<ul><li>Nested</li></ul></li></ul>
<table><thead><tr><th>Name</th><th>Value</th></tr></thead>
<tbody><tr><td>alpha</td><td>1</td></tr></tbody></table>
<pre><code class="language-js">const a = 1;</code></pre>
<img src="a.svg" alt="Pic">
<div class="ad-banner">dropped</div>
</div></body></html>
HTML

printf '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' > "$DIR/a.svg"
( cd "$DIR" && exec python3 -m http.server "$PORT" >/dev/null 2>&1 ) &
SERVER=$!
sleep 1

$AB open "http://127.0.0.1:$PORT/fixture.html" >/dev/null
$AB eval --stdin < "$SCRIPT_DIR/content.js" >/dev/null
$AB eval "window.__cap=null; navigator.clipboard.writeText=(t)=>{window.__cap=t;return Promise.resolve()}; 'ok'" >/dev/null

check() { # name, got, want
  if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 (got '$2' want '$3')"; FAIL=$((FAIL+1)); fi
}
badge() { $AB eval "[...document.body.children].filter(e=>e.style.position==='fixed'&&/selected/.test(e.textContent)).map(e=>e.textContent).join('')" | tr -d '"'; }
outline() { $AB eval "document.querySelector('$1').style.outline" | tr -d '"'; }
click() { $AB eval "document.querySelector('$1').dispatchEvent(new MouseEvent('click',{bubbles:true}))" >/dev/null; }

$AB hover "#root h2" >/dev/null; sleep 0.2
check "hover outline" "$(outline '#root h2')" "red solid 2px"

click "#root h2"
check "selected outline" "$(outline '#root h2')" "rgb(37, 99, 255) solid 2px"
check "badge counts" "$(badge)" "1 selected · Enter to copy · Esc to cancel"
click "#root h2"
check "toggle off" "$(badge)" ""

click "#root h2"
$AB press Enter >/dev/null; sleep 0.4
check "toast" "$($AB eval "[...document.body.children].filter(e=>/clipboard/i.test(e.textContent)).length" | tr -d '"')" "1"
check "teardown" "$(outline '#root h2')" ""

# Full-tree conversion: assert the Markdown, not the DOM. Re-inject first,
# since the Enter above already tore the previous session down.
$AB eval --stdin < "$SCRIPT_DIR/content.js" >/dev/null
$AB eval "window.__cap=null; navigator.clipboard.writeText=(t)=>{window.__cap=t;return Promise.resolve()}; 'ok'" >/dev/null
click "#root"
$AB press Enter >/dev/null; sleep 0.4
$AB eval "window.__cap" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")))' > "$DIR/out.md"

expect() { # name, literal line that must appear
  if grep -qxF "$2" "$DIR/out.md"; then echo "PASS $1"; else echo "FAIL $1 (missing: '$2')"; FAIL=$((FAIL+1)); fi
}
expect "heading has no leading space" "## Two"
expect "inline spaces preserved" "Plain **bold** and *italic* with a [link](http://127.0.0.1:$PORT/x)."
expect "nested list indented" "  - Nested"
expect "table rendered" "| Name | Value |"
expect "code fence with language" '```js'
expect "image on its own line" "![Pic](http://127.0.0.1:$PORT/a.svg)"
if grep -qF "dropped" "$DIR/out.md"; then echo "FAIL ad class not dropped"; FAIL=$((FAIL+1)); else echo "PASS ad class dropped"; fi

[ "$FAIL" -eq 0 ] && echo "--- all checks passed ---" || { echo "--- $FAIL failed ---"; exit 1; }
