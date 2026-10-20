import { execFile } from 'node:child_process';

/** PowerShell 静态分析结果；不包含执行命令产生的数据。 */
export interface PowerShellPathAnalysis {
  valid: boolean;
  paths: string[];
  /** 命令是否只包含读取操作。 */
  readOnly: boolean;
}

// 使用真实语法树和参数绑定解析路径，绝不求值或执行传入的命令。
const parserScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($request.command, [ref]$tokens, [ref]$errors)
$paths = [System.Collections.Generic.List[string]]::new()
$readOnly = $true
$readOnlyCommands = @(
  'Get-ChildItem', 'Get-Content', 'Get-Item', 'Get-ItemProperty', 'Get-ItemPropertyValue',
  'Get-Location', 'Get-Command', 'Get-Help', 'Get-Member', 'Get-Module', 'Get-Process',
  'Get-Service', 'Get-Date', 'Get-Random', 'Get-FileHash', 'Get-Acl', 'Get-Alias',
  'Get-Culture', 'Get-ExecutionPolicy', 'Get-History', 'Get-Host', 'Get-PSDrive',
  'Get-PSProvider', 'Get-TimeZone', 'Get-UICulture', 'Get-Variable', 'Get-WinEvent',
  'Get-EventLog', 'Get-Unique', 'Select-String', 'Select-Object', 'Where-Object',
  'ForEach-Object', 'Measure-Object', 'Sort-Object', 'Group-Object', 'Compare-Object',
  'Test-Path', 'Resolve-Path', 'Split-Path', 'Join-Path', 'Test-Json',
  'ConvertTo-Json', 'ConvertFrom-Json', 'ConvertTo-Csv', 'ConvertFrom-Csv',
  'Format-Table', 'Format-List', 'Format-Wide', 'Format-Custom', 'Out-String',
  'Write-Output', 'Write-Host', 'Write-Verbose', 'Write-Warning', 'Write-Debug',
  'Write-Information', 'Write-Progress'
)

function Add-Path($value, [bool]$literal) {
  foreach ($item in @($value)) {
    if ($item -isnot [string] -or [string]::IsNullOrWhiteSpace($item)) { throw '动态或空路径' }
    $provider = $null
    $drive = $null
    $resolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($item, [ref]$provider, [ref]$drive)
    if ($provider.Name -ne 'FileSystem') { throw '不支持非文件系统路径' }
    $root = [IO.Path]::GetFullPath($request.cwd).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if ($resolved -ne $root.TrimEnd([IO.Path]::DirectorySeparatorChar) -and -not $resolved.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw '目录外路径' }
    $paths.Add($resolved)
    if (-not $literal -and [System.Management.Automation.WildcardPattern]::ContainsWildcardCharacters($item)) {
      # 同时检查通配符前的目录和每个匹配项，避免目录链接绕过权限。
      $prefix = ($resolved -split '[*?\[]', 2)[0]
      $paths.Add([IO.Path]::GetDirectoryName($prefix))
      foreach ($match in @(Resolve-Path -Path $item -ErrorAction SilentlyContinue)) {
        if ($match.Provider.Name -ne 'FileSystem') { throw '不支持非文件系统路径' }
        $paths.Add($match.ProviderPath)
      }
    }
  }
}

function Read-StaticValue($node) {
  # 仅计算常量字符串替换，不运行输入中的命令或任意方法。
  if ($null -eq $node) { throw '缺少路径值' }
  if ($node -is [System.Management.Automation.Language.ParenExpressionAst] -and
      $node.Pipeline -is [System.Management.Automation.Language.PipelineAst] -and
      $node.Pipeline.PipelineElements.Count -eq 1 -and
      $node.Pipeline.PipelineElements[0] -is [System.Management.Automation.Language.CommandExpressionAst]) {
    return Read-StaticValue $node.Pipeline.PipelineElements[0].Expression
  }
  if ($node -is [System.Management.Automation.Language.InvokeMemberExpressionAst]) {
    if (-not (Test-StringReplace $node)) { throw '不支持的方法调用' }
    $value = Read-StaticValue $node.Expression
    if ($value -isnot [string]) { throw '不是静态字符串' }
    return $value.Replace((Read-StaticValue $node.Arguments[0]), (Read-StaticValue $node.Arguments[1]))
  }
  return $node.SafeGetValue()
}

function Test-StringExpression($node) {
  if ($node -is [System.Management.Automation.Language.StringConstantExpressionAst]) { return $true }
  if ($node -is [System.Management.Automation.Language.ExpandableStringExpressionAst]) { return $node.NestedExpressions.Count -eq 0 }
  if ($node -is [System.Management.Automation.Language.InvokeMemberExpressionAst]) { return Test-StringReplace $node }
  if ($node -is [System.Management.Automation.Language.ParenExpressionAst] -and
      $node.Pipeline -is [System.Management.Automation.Language.PipelineAst] -and
      $node.Pipeline.PipelineElements.Count -eq 1) {
    $element = $node.Pipeline.PipelineElements[0]
    if ($element -is [System.Management.Automation.Language.CommandExpressionAst]) { return Test-StringExpression $element.Expression }
    if ($element -is [System.Management.Automation.Language.CommandAst]) {
      $info = Get-Command -Name $element.GetCommandName() -CommandType Cmdlet,Alias -ErrorAction SilentlyContinue
      if ($info -is [System.Management.Automation.AliasInfo]) { $info = Get-Command -Name $info.Definition -CommandType Cmdlet -ErrorAction Stop }
      if ($info.Name -eq 'Get-Content') {
        $binding = [System.Management.Automation.Language.StaticParameterBinder]::BindCommand($element)
        if (-not $binding.BoundParameters.ContainsKey('Raw')) { return $false }
        $raw = $binding.BoundParameters['Raw']
        $rawValue = if ($raw.Value) { Read-StaticValue $raw.Value } else { $raw.ConstantValue }
        return $rawValue -eq $true -and
          -not $binding.BoundParameters.ContainsKey('AsByteStream') -and
          (-not $binding.BoundParameters.ContainsKey('Encoding') -or
            (Read-StaticValue $binding.BoundParameters['Encoding'].Value) -ne 'Byte')
      }
    }
  }
  return $false
}

function Test-StringReplace($node) {
  if ($node.Static -or $node.Member -isnot [System.Management.Automation.Language.StringConstantExpressionAst] -or
      $node.Member.Value -ine 'Replace' -or $node.Arguments.Count -ne 2) { return $false }
  foreach ($argument in $node.Arguments) {
    if ((Read-StaticValue $argument) -isnot [string]) { return $false }
  }
  return Test-StringExpression $node.Expression
}

try {
  if ($errors.Count -gt 0) { throw '语法错误' }
  $unsupported = $ast.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.AssignmentStatementAst] -or
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -or
    $node -is [System.Management.Automation.Language.UsingStatementAst]
  }, $true)
  if ($unsupported.Count -gt 0) { throw '无法静态确认的执行上下文' }
  foreach ($method in $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.InvokeMemberExpressionAst] }, $true)) {
    if (-not (Test-StringReplace $method)) { throw '不支持的方法调用' }
  }
  # 按源码顺序处理命令和重定向，使相对路径跟随已确认的目录切换。
  $operations = $ast.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -or
    $node -is [System.Management.Automation.Language.FileRedirectionAst]
  }, $true) | Sort-Object { $_.Extent.StartOffset }
  foreach ($command in $operations) {
    if ($command -is [System.Management.Automation.Language.FileRedirectionAst]) {
      $readOnly = $false
      Add-Path (Read-StaticValue $command.Location) $true
      continue
    }
    $name = $command.GetCommandName()
    if (-not $name) { throw '动态命令名' }
    $info = Get-Command -Name $name -CommandType Cmdlet,Alias -ErrorAction SilentlyContinue
    # 别名指向的模块可能尚未加载，显式解析定义，不能将空 ResolvedCommand 当作外部程序。
    if ($info -is [System.Management.Automation.AliasInfo]) { $info = Get-Command -Name $info.Definition -CommandType Cmdlet -ErrorAction Stop }
    $canonical = if ($info) { $info.Name } else { [IO.Path]::GetFileNameWithoutExtension($name) }
    if ($canonical -in @('Push-Location','Pop-Location','Set-Alias','New-Alias','Import-Alias','Invoke-Expression','Invoke-Command','Start-Process','Start-Job','Start-ThreadJob','Import-Module','New-PSDrive','Remove-PSDrive','Set-Variable','New-Variable','Remove-Variable','pwsh','powershell','cmd','bash','sh')) { throw '无法静态确认的执行上下文' }
    if ($canonical -ne 'Set-Location' -and $canonical -notin $readOnlyCommands) { $readOnly = $false }
    if (-not $info -and ($name -match '[/\\:]' -or $name.StartsWith('.'))) { Add-Path $name $true }
    if ($info -and $info.CommandType -eq 'Cmdlet') {
      $binding = [System.Management.Automation.Language.StaticParameterBinder]::BindCommand($command)
      if ($binding.BindingExceptions.Count -gt 0) { throw '无法绑定参数' }
      if ($canonical -eq 'Set-Location') {
        # 只跟踪顶层独立语句，避免条件、循环、管道和子表达式改变目录推导结果。
        $pipeline = $command.Parent
        if ($pipeline -isnot [System.Management.Automation.Language.PipelineAst] -or
            $pipeline.Parent -ne $ast.EndBlock -or $pipeline.PipelineElements.Count -ne 1 -or
            $pipeline.Background -or $command.Redirections.Count -gt 0 -or
            @($binding.BoundParameters.Keys | Where-Object { $_ -notin @('Path','LiteralPath') }).Count -gt 0) { throw '无法静态确认的目录切换' }
        $key = if ($binding.BoundParameters.ContainsKey('LiteralPath')) { 'LiteralPath' } else { 'Path' }
        $target = Read-StaticValue $binding.BoundParameters[$key].Value
        $locations = if ($key -eq 'LiteralPath') { @(Resolve-Path -LiteralPath $target -ErrorAction Stop) } else { @(Resolve-Path -Path $target -ErrorAction Stop) }
        $locations = @($locations | Where-Object { Test-Path -LiteralPath $_.ProviderPath -PathType Container })
        if ($locations.Count -ne 1) { throw '目录切换目标不唯一或不是目录' }
        Add-Path $locations[0].ProviderPath $true
        Set-Location -LiteralPath $locations[0].ProviderPath
        continue
      }
      if ($binding.BoundParameters.ContainsKey('FollowSymlink')) { throw '无法静态确认递归链接目标' }
      $isLink = $canonical -eq 'New-Item' -and $binding.BoundParameters.ContainsKey('ItemType') -and (Read-StaticValue $binding.BoundParameters['ItemType'].Value) -in @('SymbolicLink', 'Junction', 'HardLink')
      $hasInputPath = $false
      foreach ($entry in $binding.BoundParameters.GetEnumerator()) {
        $key = $entry.Key
        if ($key -match 'Path$|^Destination$|^Target$|^NewName$|^OutFile$|^OutputDirectory$|^RedirectStandard' -or ($isLink -and $key -eq 'Value')) {
          if ($key -in @('Path', 'LiteralPath', 'FilePath')) { $hasInputPath = $true }
          $value = Read-StaticValue $entry.Value.Value
          Add-Path $value ($key -eq 'LiteralPath' -or $key -notmatch 'Path$')
          if ($key -in @('Path', 'LiteralPath') -and $canonical -in @('Copy-Item', 'Move-Item', 'Remove-Item') -and $binding.BoundParameters.ContainsKey('Recurse')) {
            foreach ($source in @($value)) {
              $sourcePaths = if ($key -eq 'LiteralPath') { Resolve-Path -LiteralPath $source } else { Resolve-Path -Path $source }
              foreach ($sourcePath in $sourcePaths) {
                foreach ($child in Get-ChildItem -LiteralPath $sourcePath.ProviderPath -Recurse -Force) { $paths.Add($child.FullName) }
              }
            }
          }
        }
      }
      # 管道中的字符串和对象可能绑定为路径，不能仅检查命令自身的参数。
      $takesPath = $info.Parameters.ContainsKey('Path') -or $info.Parameters.ContainsKey('LiteralPath') -or $info.Parameters.ContainsKey('FilePath')
      if ($takesPath -and -not $hasInputPath -and $command.Parent -is [System.Management.Automation.Language.PipelineAst] -and $command.Parent.PipelineElements[0] -ne $command) { throw '无法静态确认管道路径' }
    } else {
      # 外部程序的选项协议未知，只检查静态参数中的显式路径和现存文件名。
      foreach ($element in @($command.CommandElements | Select-Object -Skip 1)) {
        if ($element -is [System.Management.Automation.Language.CommandParameterAst]) {
          if ($element.Argument) { $value = Read-StaticValue $element.Argument }
          elseif ($element.Extent.Text -match '^--?[\w-]+=') { $value = $element.Extent.Text }
          else { continue }
        } else { $value = Read-StaticValue $element }
        foreach ($argument in @($value)) {
          if ($argument -isnot [string]) { continue }
          $candidate = $argument -replace '^--?[\w-]+=', ''
          if ($candidate -match '^https?://') { continue }
          if ($candidate -match '[/\\:]|^\.{1,2}$|^~' -or (Test-Path -LiteralPath $candidate)) { Add-Path $candidate $true }
        }
      }
    }
  }
  @{ valid = $true; paths = @($paths); readOnly = $readOnly } | ConvertTo-Json -Compress
} catch {
  @{ valid = $false; paths = @(); readOnly = $false } | ConvertTo-Json -Compress
}
`;

/** 调用无配置文件的 PowerShell 解析器，按真实参数语义提取路径。 */
export function getPowerShellPaths(
  command: string,
  cwd: string,
  shellPath: string
): Promise<PowerShellPathAnalysis> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      shellPath,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(parserScript, 'utf16le').toString('base64'),
      ],
      { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024, timeout: 15_000 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(stdout) as PowerShellPathAnalysis);
        } catch (parseError) {
          reject(parseError);
        }
      }
    );
    child.stdin?.on('error', reject);
    child.stdin?.end(JSON.stringify({ command, cwd }));
  });
}
