import { run } from "./processes.js";
import { ToolError } from "./errors.js";

export function windowsPrivacyArguments(path: string, kind: "directory" | "file", action: "protect" | "create" | "verify") {
  const encodedPath = Buffer.from(path, "utf8").toString("base64");
  const script = `
$ErrorActionPreference = 'Stop'
$path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$directory = '${kind}' -eq 'directory'
$item = if ($directory) { New-Object IO.DirectoryInfo($path) } else { New-Object IO.FileInfo($path) }
if ('${action}' -ne 'verify') {
  $acl = if ($directory) { New-Object Security.AccessControl.DirectorySecurity } else { New-Object Security.AccessControl.FileSecurity }
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true, $false)
  $inherit = if ($directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inherit, 'None', 'Allow')
  $acl.AddAccessRule($rule)
  if ($directory) {
    if ($item.Exists) { $item.SetAccessControl($acl) } else { $item.Create($acl) }
  } elseif ('${action}' -eq 'create') {
    $stream = New-Object IO.FileStream($path, [IO.FileMode]::CreateNew, [Security.AccessControl.FileSystemRights]::Write, [IO.FileShare]::None, 4096, [IO.FileOptions]::None, $acl)
    $stream.Dispose()
  } else { $item.SetAccessControl($acl) }
}
$actual = $item.GetAccessControl()
$rules = @($actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
if (!$actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 1) { throw 'DACL is not private' }
$rule = $rules[0]
if ($rule.IdentityReference.Value -ne $sid.Value -or $rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'DACL is not private' }
Write-Output 'private-dacl-verified'
`;
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}

export async function windowsPrivacy(path: string, kind: "directory" | "file", action: "protect" | "create" | "verify") {
  try {
    const result = await run("powershell.exe", windowsPrivacyArguments(path, kind, action), { timeout: 30_000 });
    if (result.trim() !== "private-dacl-verified") throw new Error("DACL was not verified");
  } catch { throw new ToolError("Cannot establish or verify current-user-only Windows credential permissions. No credentials will be used or saved. Check PowerShell and your APPDATA filesystem permissions, then retry login."); }
}
