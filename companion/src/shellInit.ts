// `sprout shell-init zsh|bash`: prints a snippet that reports each interactive command
// (raw → local daemon only, which redacts) in the background with curl --max-time 0.3.
// It never delays the prompt and never changes $?.
export function shellInit(shell: 'zsh' | 'bash', port: number): string {
  const curl = `curl -s -o /dev/null --max-time 0.3 --data-urlencode "cmd=$c" --data-urlencode "ec=$ec" --data-urlencode "cwd=$PWD" "http://127.0.0.1:${port}/event"`;
  if (shell === 'zsh') {
    return `# sprout shell hook (zsh). Only the local daemon sees the raw command; it redacts before sending.
if [[ -z "$_SPROUT_HOOKED" ]] && command -v curl >/dev/null 2>&1; then
  typeset -g _SPROUT_HOOKED=1 _sprout_cmd=""
  _sprout_preexec() { _sprout_cmd="$1"; }
  _sprout_precmd() {
    local ec=$?
    if [[ -n "$_sprout_cmd" ]]; then
      local c="$_sprout_cmd"; _sprout_cmd=""
      ( ${curl} >/dev/null 2>&1 & )
    fi
    return $ec
  }
  autoload -Uz add-zsh-hook
  add-zsh-hook preexec _sprout_preexec
  precmd_functions=(_sprout_precmd \${precmd_functions:#_sprout_precmd})
fi
`;
  }
  return `# sprout shell hook (bash). Only the local daemon sees the raw command; it redacts before sending.
if [ -z "$_SPROUT_HOOKED" ] && command -v curl >/dev/null 2>&1; then
  _SPROUT_HOOKED=1; _sprout_cmd=""; _sprout_armed=""
  _sprout_debug() {
    [ -n "$_sprout_armed" ] || return 0
    [ -n "$COMP_LINE" ] && return 0
    _sprout_armed=""; _sprout_cmd="$BASH_COMMAND"
  }
  _sprout_precmd() {
    local ec=$?
    if [ -n "$_sprout_cmd" ]; then
      local c="$_sprout_cmd"; _sprout_cmd=""
      ( ${curl} >/dev/null 2>&1 & )
    fi
    return $ec
  }
  _sprout_arm() { _sprout_armed=1; }
  trap '_sprout_debug' DEBUG
  PROMPT_COMMAND="_sprout_precmd\${PROMPT_COMMAND:+; $PROMPT_COMMAND}; _sprout_arm"
fi
`;
}
