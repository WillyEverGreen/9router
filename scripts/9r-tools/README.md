Fixed replacements for `C:\tools` (copy over, then `9r start` must say "Already running"):
- start-9router.ps1 / start-9router.cmd: the original inline `-Command` string has a PowerShell parse error, so `9r`, `9r start` and `9r restart` fail (restart stops the server, then cannot start it).
- update-9router.cmd: for a new `9r update` (npm i -g 9router@latest, then stop/start). Add an `update` branch to 9r.cmd/9r.ps1.
Also point `models`/`dev` in 9r.cmd/9r.ps1 at the repo copy you want to use.
