#!/usr/bin/env pwsh
# aidev ランタイムガード CLI（PowerShell 版・Windows 向け / pwsh でも動作）
#
# POSIX sh 版（同ディレクトリの `aidev`）と挙動・出力・終了コードを一致させること。
# 役割と正典は `aidev` 冒頭コメント／protocol.md「4.1」を参照。
#
# 使い方:
#   pwsh .aidev/bin/aidev.ps1 new <slug> [--mode interactive|autonomous] [--ticket ID] [--depends a,b,#N]
#   pwsh .aidev/bin/aidev.ps1 event <phase> <start|approved|sent_back> [key=value ...]
#   pwsh .aidev/bin/aidev.ps1 approve <phase> [key=value ...]
#   pwsh .aidev/bin/aidev.ps1 guard <phase>
#   pwsh .aidev/bin/aidev.ps1 verify [slug]
#   pwsh .aidev/bin/aidev.ps1 doctor
#   pwsh .aidev/bin/aidev.ps1 status [--format table|tsv]
#   pwsh .aidev/bin/aidev.ps1 metrics [slug] [--all] [--phases] [--format table|tsv]
#   pwsh .aidev/bin/aidev.ps1 help
#
# 終了コード: 0=OK / 1=使用法・環境エラー / 2=前提成果物の不足 / 3=依存未充足 / 4=不変条件違反

$ErrorActionPreference = 'Stop'

$script:CURRENT_SCHEMA = 2
$script:PHASES = @('requirement','research','spec','design','plan','coding','test','review','walkthrough','deliver','retro')
$script:Utf8 = New-Object System.Text.UTF8Encoding($false)  # BOM なし

function Die($m)  { [Console]::Error.WriteLine("aidev: $m"); exit 1 }
function Warn($m) { [Console]::Error.WriteLine("aidev: $m") }
function Now() {
  # 明示フォーマット（カルチャ/書式指定子の曖昧さを避け sh 版と完全一致させる）
  $d = [DateTime]::UtcNow
  return ('{0:D4}-{1:D2}-{2:D2}T{3:D2}:{4:D2}:{5:D2}Z' -f $d.Year,$d.Month,$d.Day,$d.Hour,$d.Minute,$d.Second)
}
function WriteText($p,$t)  { [System.IO.File]::WriteAllText($p,$t,$script:Utf8) }
function AppendText($p,$t) { [System.IO.File]::AppendAllText($p,$t,$script:Utf8) }

function FindRoot() {
  $d = (Get-Location).Path
  while ($true) {
    if (Test-Path (Join-Path $d '.aidev')) { return $d }
    $parent = Split-Path $d -Parent
    if ([string]::IsNullOrEmpty($parent) -or $parent -eq $d) { break }
    $d = $parent
  }
  return $null
}

$script:ROOT = FindRoot
if (-not $script:ROOT) { Die ".aidev が見つかりません（リポジトリ内で実行してください）" }
$script:AIDEV = Join-Path $script:ROOT '.aidev'

function ResolveWork($slug) {
  if (-not $slug) { $slug = $env:AIDEV_WORK }
  if (-not $slug) {
    $cur = Join-Path $script:AIDEV 'current'
    if (-not (Test-Path $cur)) { Die "対象作業が不明です（.aidev/current 無し）。new か slug 指定を。" }
    $slug = ([System.IO.File]::ReadAllLines($cur))[0].Trim()
  }
  $script:WORK = Join-Path (Join-Path $script:AIDEV 'works') $slug
  if (-not (Test-Path $script:WORK)) { Die "work が存在しません: $slug" }
  $script:SLUG = $slug
}

function IsPhase($p) { return $script:PHASES -contains $p }

# scalar 読み取り（前後空白と囲み二重引用符を除去）。inline コメント(#)は除去しない
# （ticket/dependsOn は '#18' 等 '#' 始まりの値を持つため）。sh の yget と一致。
function YGet($file,$key) {
  if (-not (Test-Path $file)) { return '' }
  foreach ($line in [System.IO.File]::ReadAllLines($file)) {
    if ($line -match ("^" + [regex]::Escape($key) + ":\s*(.*)$")) {
      return (($Matches[1].Trim()) -replace '^"','' -replace '"$','')
    }
  }
  return ''
}

function YList($file,$key) {
  $v = (YGet $file $key).Trim()
  if ($v.StartsWith('[')) { $v = $v.Substring(1) }
  if ($v.EndsWith(']'))   { $v = $v.Substring(0, $v.Length - 1) }
  $v = $v -replace '"',''
  if ([string]::IsNullOrWhiteSpace($v)) { return @() }
  return @($v -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
}

function ApprovedHas($work,$phase) { return (YList (Join-Path $work 'state.yml') 'approved') -contains $phase }

function ReplaceLine($file,$key,$newline) {
  $lines = [System.IO.File]::ReadAllLines($file)
  $out = foreach ($l in $lines) { if ($l -match ("^" + [regex]::Escape($key) + ":")) { $newline } else { $l } }
  WriteText $file (($out -join "`n") + "`n")
}

function EnsureEvents($work) {
  $f = Join-Path $work 'metrics.yml'
  if (-not (Test-Path $f)) { WriteText $f "events:`n"; return }
  $lines = [System.IO.File]::ReadAllLines($f)
  $changed = $false
  $out = foreach ($l in $lines) { if ($l -match '^events:\s*\[\]\s*$') { $changed = $true; 'events:' } else { $l } }
  if ($changed) { WriteText $f (($out -join "`n") + "`n") }
  $content = [System.IO.File]::ReadAllText($f)
  if ($content -notmatch '(?m)^events:') { AppendText $f "events:`n" }
}

function BuildEntry($phase,$event,$kvs) {
  $m = @()
  foreach ($kv in $kvs) {
    $i = $kv.IndexOf('=')
    if ($i -ge 0) { $k = $kv.Substring(0,$i); $val = $kv.Substring($i+1); $m += "${k}: $val" }
  }
  $base = "{ ts: $(Now), phase: $phase, event: $event"
  if ($m.Count -gt 0) { return "$base, metrics: { $([string]::Join(', ',$m)) } }" }
  return "$base }"
}

function AppendEvent($work,$phase,$event,$kvs) {
  EnsureEvents $work
  AppendText (Join-Path $work 'metrics.yml') ("  - " + (BuildEntry $phase $event $kvs) + "`n")
}

# --- new ---------------------------------------------------------------------
function Cmd-New($rest) {
  $slug=''; $mode='interactive'; $ticket=''; $depends=''
  for ($i=0; $i -lt $rest.Count; $i++) {
    switch ($rest[$i]) {
      '--mode'    { $mode=$rest[++$i] }
      '--ticket'  { $ticket=$rest[++$i] }
      '--depends' { $depends=$rest[++$i] }
      default {
        if ($rest[$i].StartsWith('-')) { Die "未知のオプション: $($rest[$i])" }
        if ($slug) { Die "slug は1つだけ" } else { $slug=$rest[$i] }
      }
    }
  }
  if (-not $slug) { Die "使用法: aidev new <slug> [--mode ..] [--ticket ..] [--depends ..]" }
  if ($mode -ne 'interactive' -and $mode -ne 'autonomous') { Die "mode は interactive|autonomous" }

  $dateP = [DateTime]::UtcNow.ToString('yyyyMMdd')
  $base = "$dateP-$slug"; $name=$base; $n=2
  while (Test-Path (Join-Path (Join-Path $script:AIDEV 'works') $name)) { $name="$base-$n"; $n++ }
  $work = Join-Path (Join-Path $script:AIDEV 'works') $name
  New-Item -ItemType Directory -Path $work -Force | Out-Null

  $depsYaml='[]'
  if ($depends) {
    $parts = @($depends -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
    $depsYaml = '[' + ([string]::Join(', ',$parts)) + ']'
  }

  $sb = "schema: $($script:CURRENT_SCHEMA)`nslug: $slug`n"
  if ($ticket) { $sb += "ticket: $ticket`n" }
  $sb += "current: requirement`napproved: []`nmode: $mode`nhumanGates: []`nmaxSendBacks: 3`ndependsOn: $depsYaml`n"
  WriteText (Join-Path $work 'state.yml') $sb
  WriteText (Join-Path $work 'metrics.yml') "events:`n"
  WriteText (Join-Path $script:AIDEV 'current') "$name`n"
  Write-Output "created: $work (schema $($script:CURRENT_SCHEMA), mode $mode)"
}

# --- event -------------------------------------------------------------------
function Cmd-Event($rest) {
  if ($rest.Count -lt 2) { Die "使用法: aidev event <phase> <start|approved|sent_back> [k=v ...]" }
  $ph=$rest[0]; $ev=$rest[1]; $kvs=@(); if ($rest.Count -gt 2) { $kvs=$rest[2..($rest.Count-1)] }
  if (-not (IsPhase $ph)) { Die "未知の phase: $ph" }
  if ('start','approved','sent_back' -notcontains $ev) { Die "event は start|approved|sent_back" }
  ResolveWork ''
  AppendEvent $script:WORK $ph $ev $kvs
  Write-Output "recorded: $($script:SLUG)/$ph/$ev"
}

# --- approve -----------------------------------------------------------------
function Cmd-Approve($rest) {
  if ($rest.Count -lt 1) { Die "使用法: aidev approve <phase> [k=v ...]" }
  $ph=$rest[0]; $kvs=@(); if ($rest.Count -gt 1) { $kvs=$rest[1..($rest.Count-1)] }
  if (-not (IsPhase $ph)) { Die "未知の phase: $ph" }
  ResolveWork ''
  $st = Join-Path $script:WORK 'state.yml'
  if (-not (Test-Path $st)) { Die "state.yml がありません: $($script:SLUG)" }

  if (-not (ApprovedHas $script:WORK $ph)) {
    $cur = YList $st 'approved'
    if ($cur.Count -eq 0) { $newl = "[$ph]" }
    else { $newl = '[' + ([string]::Join(', ', ($cur + $ph))) + ']' }
    ReplaceLine $st 'approved' "approved: $newl"
  }
  ReplaceLine $st 'current' "current: $ph"
  AppendEvent $script:WORK $ph 'approved' $kvs
  Write-Output "approved: $ph @ $($script:SLUG)"
}

# 依存(dependsOn)の充足を読み取り専用で評価（state は変更しない）。
# 結果を $script:EvalUnmet（works 由来の未充足・exit に影響）/ $script:EvalAdvisory（外部チケット #N）に格納。
function Eval-Depends($workDir) {
  $script:EvalUnmet = @(); $script:EvalAdvisory = @()
  foreach ($d in (YList (Join-Path $workDir 'state.yml') 'dependsOn')) {
    if (-not $d) { continue }
    if ($d.StartsWith('#')) { $script:EvalAdvisory += $d; continue }
    $depWork = Join-Path (Join-Path $script:AIDEV 'works') $d
    if (Test-Path $depWork) {
      if ((YList (Join-Path $depWork 'state.yml') 'approved') -notcontains 'deliver') { $script:EvalUnmet += "$d(未deliver)" }
    } else { $script:EvalUnmet += "$d(work不明)" }
  }
}

# --- guard -------------------------------------------------------------------
function Cmd-Guard($rest) {
  if ($rest.Count -lt 1) { Die "使用法: aidev guard <phase>" }
  $ph=$rest[0]
  if (-not (IsPhase $ph)) { Die "未知の phase: $ph" }
  ResolveWork ''
  $miss=@(); $unapp=@()
  function needFile($f) { if (-not (Test-Path (Join-Path $script:WORK $f))) { $script:miss += $f } }
  function needApproved($p) { if (-not (ApprovedHas $script:WORK $p)) { $script:unapp += $p } }
  $script:miss=@(); $script:unapp=@()
  switch ($ph) {
    'requirement' { }
    'research'    { needFile 'requirement.md' }
    'spec'        { needFile 'requirement.md' }
    'design'      { needFile 'spec.md' }
    'plan'        { needFile 'spec.md' }
    'coding'      { needFile 'plan.md'; needFile 'tasks.md' }
    'test'        { needFile 'tasks.md' }
    'review'      { needFile 'spec.md' }
    'walkthrough' { needApproved 'review' }
    'deliver'     { needApproved 'review' }
    'retro'       { needApproved 'deliver' }
  }
  # dependsOn（共有 Eval-Depends を使用。挙動は従来と一致）
  Eval-Depends $script:WORK
  $dep = $script:EvalUnmet
  foreach ($a in $script:EvalAdvisory) { Warn "依存(外部チケット $a): 自動判定不可＝advisory（手動確認）" }

  $rc=0
  if ($script:miss.Count -gt 0)  { [Console]::Error.WriteLine("NG 前提成果物が不足: " + ($script:miss -join ' ')); $rc=2 }
  if ($script:unapp.Count -gt 0) { [Console]::Error.WriteLine("NG 前提工程が未承認: " + ($script:unapp -join ' ')); $rc=2 }
  if ($dep.Count -gt 0)          { [Console]::Error.WriteLine("NG 依存(dependsOn)が未充足: " + ($dep -join ' ')); if ($rc -eq 0) { $rc=3 } }
  if ($rc -eq 0) { Write-Output "OK guard $ph @ $($script:SLUG)" }
  exit $rc
}

# --- verify ------------------------------------------------------------------
function VerifyWork($work) {
  # 注意: 状態行は [Console]::Out へ直接出す（戻り値=intだけにし、$rc=VerifyWork が出力を取り込む PS の罠を回避）
  $st = Join-Path $work 'state.yml'
  if (-not (Test-Path $st)) { [Console]::Out.WriteLine("  FAIL state.yml なし"); return 4 }
  $vf=@()
  foreach ($k in 'slug','current','approved') {
    $found=$false
    foreach ($l in [System.IO.File]::ReadAllLines($st)) { if ($l -match ("^"+$k+":")) { $found=$true; break } }
    if (-not $found) { $vf += "state.yml:${k}欠落" }
  }
  $schema = YGet $st 'schema'
  if ([string]::IsNullOrEmpty($schema)) {
    [Console]::Out.WriteLine("  SKIP legacy (schema 未記載・metrics導入前の作業として免除)")
  } else {
    $sn = 0; [void][int]::TryParse($schema, [ref]$sn)
    if ($sn -ge 2) {
      if (-not (Test-Path (Join-Path $work 'metrics.yml'))) { $vf += "metrics.yml欠落" }
      if (ApprovedHas $work 'review') { if (-not (Test-Path (Join-Path $work 'review.md'))) { $vf += "review.md欠落(review承認済)" } }
      if (ApprovedHas $work 'deliver') {
        $mf = Join-Path $work 'metrics.yml'; $ok=$false
        if (Test-Path $mf) { foreach ($l in [System.IO.File]::ReadAllLines($mf)) { if ($l -match 'phase:\s*deliver' -and $l -match 'event:\s*approved') { $ok=$true; break } } }
        if (-not $ok) { $vf += "deliver承認イベントがmetricsに無い" }
      }
    }
  }
  if ($vf.Count -gt 0) { [Console]::Out.WriteLine("  FAIL " + ($vf -join ' ')); return 4 }
  [Console]::Out.WriteLine("  OK"); return 0
}

function Cmd-Verify($rest) {
  $slug=''; if ($rest.Count -ge 1) { $slug=$rest[0] }
  ResolveWork $slug
  Write-Output "verify: $($script:SLUG)"
  $rc = VerifyWork $script:WORK
  exit $rc
}

# --- doctor ------------------------------------------------------------------
function Cmd-Doctor() {
  $worksDir = Join-Path $script:AIDEV 'works'
  if (-not (Test-Path $worksDir)) { Die "works がありません" }
  $total=0; $fail=0; $legacy=0
  Write-Output "doctor: 全 work 横断検査"
  foreach ($d in (Get-ChildItem -Path $worksDir -Directory | Sort-Object Name)) {
    $total++
    Write-Output ("- " + $d.Name)
    $sc = YGet (Join-Path $d.FullName 'state.yml') 'schema'
    if ([string]::IsNullOrEmpty($sc)) { $legacy++ }
    if ((VerifyWork $d.FullName) -ne 0) { $fail++ }
  }
  Write-Output "summary: works=$total fail=$fail legacy(免除)=$legacy"
  if ($fail -eq 0) { exit 0 } else { exit 1 }
}

# --- status（読み取り専用・works横断＋backlog未着手） ----------------------------
$script:STD_PIPELINE = @('requirement','spec','plan','coding','test','review','deliver')

# タブ区切り行（先頭にヘッダ含む）を列幅で揃えた行配列に整形（sh の fmt_table と一致）
function Fmt-Table($rows) {
  $w=@{}; $maxnf=0; $cells=@()
  foreach ($r in $rows) {
    $cols = $r -split "`t"
    $cells += ,$cols
    if ($cols.Count -gt $maxnf) { $maxnf = $cols.Count }
    for ($i=0; $i -lt $cols.Count; $i++) {
      if (-not $w.ContainsKey($i) -or $cols[$i].Length -gt $w[$i]) { $w[$i] = $cols[$i].Length }
    }
  }
  $out=@()
  foreach ($cols in $cells) {
    $line=''
    for ($i=0; $i -lt $maxnf; $i++) {
      $c = if ($i -lt $cols.Count) { $cols[$i] } else { '' }
      if ($i -lt $maxnf-1) { $line += $c + (' ' * ($w[$i]-$c.Length)) + '  ' } else { $line += $c }
    }
    $out += $line
  }
  return $out
}

function Cmd-Status($rest) {
  $fmt='table'
  for ($i=0; $i -lt $rest.Count; $i++) {
    switch ($rest[$i]) {
      '--format' { $fmt=$rest[++$i] }
      default {
        if ($rest[$i].StartsWith('-')) { Die "未知のオプション: $($rest[$i])" }
        else { Die "status は位置引数を取りません: $($rest[$i])" }
      }
    }
  }
  if ($fmt -ne 'table' -and $fmt -ne 'tsv') { Die "--format は table|tsv" }

  $worksDir = Join-Path $script:AIDEV 'works'
  $wrows=@(); $wn=0
  if (Test-Path $worksDir) {
    foreach ($d in (Get-ChildItem -Path $worksDir -Directory | Sort-Object Name)) {
      $st = Join-Path $d.FullName 'state.yml'
      if (-not (Test-Path $st)) { continue }
      $ticket = YGet $st 'ticket';  if (-not $ticket)  { $ticket='-' }
      $mode = YGet $st 'mode';      if (-not $mode)    { $mode='-' }
      $current = YGet $st 'current';if (-not $current) { $current='-' }
      $appr = YList $st 'approved'
      $wdone = if ($appr -contains 'deliver') { 'yes' } else { 'no' }
      $next='-'
      if ($wdone -eq 'no') { foreach ($p in $script:STD_PIPELINE) { if ($appr -notcontains $p) { $next=$p; break } } }
      Eval-Depends $d.FullName
      $tok=@()
      foreach ($u in $script:EvalUnmet) { $tok += $u }
      foreach ($a in $script:EvalAdvisory) { $tok += "$a(advisory)" }
      $deps = if ($tok.Count -gt 0) { [string]::Join(',', $tok) } else { 'ok' }
      $wn++
      $wrows += ($d.Name + "`t" + $ticket + "`t" + $mode + "`t" + $current + "`t" + $next + "`t" + $wdone + "`t" + $deps)
    }
  }

  $backlogDir = Join-Path $script:AIDEV 'backlog'
  $brows=@(); $bf=0; $bn=0
  if (Test-Path $backlogDir) {
    foreach ($f in (Get-ChildItem -Path $backlogDir -File -Filter *.md | Sort-Object Name)) {
      $todo=0; $needs=0
      foreach ($l in [System.IO.File]::ReadAllLines($f.FullName)) {
        if ($l -match '^\s*- \[ \]') { $todo++; if ($l -match '\(needs:') { $needs++ } }
      }
      $bf++; $bn += $todo
      $brows += ($f.Name + "`t" + $todo + "`t" + $needs)
    }
  }

  if ($fmt -eq 'tsv') {
    foreach ($r in $wrows) { Write-Output ("work`t" + $r) }
    foreach ($r in $brows) { Write-Output ("backlog`t" + $r) }
    return
  }

  Write-Output "WORKS ($wn)"
  if ($wn -gt 0) { foreach ($l in (Fmt-Table (@("work`tticket`tmode`tcurrent`tnext`tdone`tdeps") + $wrows))) { Write-Output $l } }
  Write-Output ""
  Write-Output "BACKLOG (未着手 $bn 件)"
  if ($bf -gt 0) { foreach ($l in (Fmt-Table (@("file`ttodo`tneeds") + $brows))) { Write-Output $l } }
}

# --- metrics（読み取り専用・metrics.yml から派生指標を集計） ----------------------
function Mt-Epoch($ts) {
  $t = ($ts -replace 'Z$','') -replace 'UTC$',''
  if ($t.Length -lt 19 -or $t.Substring(10,1) -ne 'T') { return -1 }
  try {
    $dt = [DateTime]::ParseExact($t.Substring(0,19), 'yyyy-MM-ddTHH:mm:ss', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None)
    return [int64]([DateTimeOffset]::new($dt, [TimeSpan]::Zero).ToUnixTimeSeconds())
  } catch { return -1 }
}

function Cmd-Metrics($rest) {
  $fmt='table'; $allf=$false; $phasesf=$false; $mslug=''
  for ($i=0; $i -lt $rest.Count; $i++) {
    switch ($rest[$i]) {
      '--all'     { $allf=$true }
      '--phases'  { $phasesf=$true }
      '--format'  { $fmt=$rest[++$i] }
      default {
        if ($rest[$i].StartsWith('-')) { Die "未知のオプション: $($rest[$i])" }
        elseif ($mslug) { Die "slug は1つだけ" } else { $mslug=$rest[$i] }
      }
    }
  }
  if ($fmt -ne 'table' -and $fmt -ne 'tsv') { Die "--format は table|tsv" }

  $worksDir = Join-Path $script:AIDEV 'works'
  $dirs=@()
  if ($allf) {
    if (Test-Path $worksDir) { $dirs = @(Get-ChildItem -Path $worksDir -Directory | Sort-Object Name | ForEach-Object { $_.FullName }) }
  } elseif ($mslug) {
    $p = Join-Path $worksDir $mslug
    if (-not (Test-Path $p)) { Die "work が存在しません: $mslug" }
    $dirs=@($p)
  } else {
    $cur = Join-Path $script:AIDEV 'current'
    if (-not (Test-Path $cur)) { Die "対象作業が不明です（.aidev/current 無し）。slug 指定か --all を。" }
    $c = ([System.IO.File]::ReadAllLines($cur))[0].Trim()
    $p = Join-Path $worksDir $c
    if (-not (Test-Path $p)) { Die "work が存在しません: $c" }
    $dirs=@($p)
  }

  $rows=@()
  foreach ($wd in $dirs) {
    $name = Split-Path $wd -Leaf
    $mf = Join-Path $wd 'metrics.yml'
    $first=-1; $firstts='-'; $deliveredFlag=$false; $deliveredE=-1; $sback=0
    $scount=@{}; $laststart=@{}; $laststartTs=@{}; $appat=@{}; $appatTs=@{}
    if (Test-Path $mf) {
      foreach ($line in [System.IO.File]::ReadAllLines($mf)) {
        if ($line -notmatch 'event:') { continue }
        $ts=''; $ph=''; $ev=''
        if ($line -match 'ts:\s*([^,}]+)')      { $ts = $Matches[1].Trim() }
        if ($line -match 'phase:\s*([A-Za-z_]+)'){ $ph = $Matches[1] }
        if ($line -match 'event:\s*([A-Za-z_]+)'){ $ev = $Matches[1] }
        if (-not $ph -or -not $ev) { continue }
        $e = Mt-Epoch $ts
        if ($ev -eq 'start') {
          if ($scount.ContainsKey($ph)) { $scount[$ph]++ } else { $scount[$ph]=1 }
          if ($e -ge 0) {
            if ($first -lt 0 -or $e -lt $first) { $first=$e; $firstts=$ts }
            if (-not $laststart.ContainsKey($ph) -or $e -gt $laststart[$ph]) { $laststart[$ph]=$e; $laststartTs[$ph]=$ts }
          }
        } elseif ($ev -eq 'approved') {
          if ($e -ge 0) { $appat[$ph]=$e; $appatTs[$ph]=$ts }
          if ($ph -eq 'deliver') { $deliveredFlag=$true; if ($e -ge 0) { $deliveredE=$e } }
        } elseif ($ev -eq 'sent_back') { $sback++ }
      }
    }
    if ($phasesf) {
      foreach ($p in $script:PHASES) {
        if ($laststart.ContainsKey($p) -or $appat.ContainsKey($p)) {
          $st = if ($laststartTs.ContainsKey($p)) { $laststartTs[$p] } else { '-' }
          $ap = if ($appatTs.ContainsKey($p))     { $appatTs[$p] }     else { '-' }
          $el = '-'
          if ($laststart.ContainsKey($p) -and $appat.ContainsKey($p)) { $el = $appat[$p]-$laststart[$p] }
          $rows += ($name + "`t" + $p + "`t" + $st + "`t" + $ap + "`t" + $el)
        }
      }
    } else {
      $fs = if ($first -ge 0) { $firstts } else { '-' }
      $dv = if ($deliveredFlag) { 'yes' } else { 'no' }
      $lead = '-'
      if ($deliveredFlag -and $first -ge 0 -and $deliveredE -ge 0) { $lead = $deliveredE-$first }
      $rw=0; foreach ($k in $scount.Keys) { if ($scount[$k] -ge 2) { $rw++ } }
      $rows += ($name + "`t" + $fs + "`t" + $dv + "`t" + $lead + "`t" + $rw + "`t" + $sback)
    }
  }

  if ($phasesf) { $hdr = "work`tphase`tstart`tapproved`telapsed_sec" }
  else          { $hdr = "work`tfirst_start`tdelivered`tlead_sec`treworks`tsent_backs" }

  if ($fmt -eq 'tsv') { foreach ($r in $rows) { Write-Output $r } }
  else { foreach ($l in (Fmt-Table (@($hdr) + $rows))) { Write-Output $l } }
}

function Usage() {
  # 先頭(2行目以降)の連続するコメント行のみを出力（コメント末尾で停止。範囲ズレに強い）
  foreach ($l in (Get-Content $PSCommandPath | Select-Object -Skip 1)) {
    if ($l -match '^#') { $l -replace '^#\s?','' } else { break }
  }
}

if ($args.Count -lt 1) { Usage; exit 1 }
$cmd = $args[0]
$rest = @(); if ($args.Count -gt 1) { $rest = $args[1..($args.Count-1)] }
switch ($cmd) {
  'new'     { Cmd-New $rest }
  'event'   { Cmd-Event $rest }
  'approve' { Cmd-Approve $rest }
  'guard'   { Cmd-Guard $rest }
  'verify'  { Cmd-Verify $rest }
  'doctor'  { Cmd-Doctor }
  'status'  { Cmd-Status $rest }
  'metrics' { Cmd-Metrics $rest }
  'help'    { Usage }
  '-h'      { Usage }
  '--help'  { Usage }
  default   { Die "未知のコマンド: $cmd（aidev help）" }
}
