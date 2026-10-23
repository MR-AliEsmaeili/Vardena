# Offline signer — private-key file permissions

The offline signer (`owner-licensing/backend/src/signer/cli.ts`,
`src/signer/key-permissions.ts`) refuses to read or load a private key until it
has verified that the key file is private. A refusal is
`key-unavailable` and exits with status `3`; no request is signed and the key is
not parsed.

The rule is deliberately different per platform because the operating-system
facts are different:

| Platform | What is checked | Why |
|---|---|---|
| POSIX (`linux`, `darwin`, BSD, …) | `stat(2)` mode has **no group or other bits** (`mode & 0o077 === 0`) | These bits are the access control that the kernel enforces. |
| Windows (`win32`) | The file's **effective DACL** (including inherited ACEs), read through Windows PowerShell `Get-Acl` | Node reports a synthesized mode such as `100666` on NTFS regardless of the real security descriptor, so a mode check both rejects secure files and proves nothing. |
| Anything else | Refused | An unknown platform cannot be verified, so it cannot be allowed to sign. |

## POSIX

The key file must be readable only by the account that runs the signer: no
group or other permission bit may be set.

```sh
chmod 600 /path/to/authority.pkcs8
```

`0600`, `0400` and `0700` are accepted. `0644`, `0640`, `0660`, `0604` and any
other mode with a set group or other bit are refused. The file is not modified
by the signer.

## Windows

### Accepted principals

An **allow** access-control entry on the key file is accepted only for:

| SID | Principal |
|---|---|
| the SID of the account running the signer | the signing operator |
| `S-1-5-18` | `NT AUTHORITY\SYSTEM` |
| `S-1-5-32-544` | `BUILTIN\Administrators` |

Every other principal is refused if it has **any** allowed access, not only
read access. This includes, but is not limited to:

- `S-1-1-0` — `Everyone`
- `S-1-5-32-545` — `BUILTIN\Users`
- `S-1-5-11` — `NT AUTHORITY\Authenticated Users`
- `S-1-5-32-546` — `BUILTIN\Guests`
- `S-1-5-4` — `NT AUTHORITY\INTERACTIVE`
- `S-1-5-6` — `NT AUTHORITY\SERVICE`
- `S-1-5-2` — `NT AUTHORITY\NETWORK`
- `S-1-5-7` — `NT AUTHORITY\ANONYMOUS LOGON`
- `S-1-15-2-1` / `S-1-15-2-2` — all application packages
- any local or domain group, application-specific SID, or unresolved SID

The check uses SIDs, not display names, so it behaves the same on a localized
Windows installation. `SYSTEM` and `Administrators` are accepted because they
can take ownership of any local file regardless of its DACL; granting them
access is not treated as a broad read grant. They are not required.

The **owner** of the file must be in the same accepted set. An owner outside it
could rewrite the DACL to grant itself access even when the current DACL looks
restricted, so the signer refuses that file.

Deny entries grant nothing and are ignored. Inheritance-only entries apply to
child objects and therefore grant nothing on the key file itself; they are
ignored. Every effective allow entry, whether explicit or **inherited**, is
otherwise subject to the same rule: an inherited grant to `BUILTIN\Users` is
refused.

### Exact secure setup

Run these commands as the account that will run the signer. `whoami` prints the
exact `DOMAIN\user` value to use:

```bat
whoami
set "SIGNER_ACCOUNT=%USERDOMAIN%\%USERNAME%"
mkdir "%USERPROFILE%\vardena-signing"
copy authority.pkcs8 "%USERPROFILE%\vardena-signing\authority.pkcs8"
```

`whoami` must print the same `DOMAIN\user` that `%SIGNER_ACCOUNT%` expands
to (for example `WORKSTATION\alice` or `CONTOSO\alice`). If it does not — for
example on some Microsoft-account sign-ins — set `SIGNER_ACCOUNT` to the exact
`whoami` output before continuing. Remove inherited access and grant only that
account:

```bat
icacls "%USERPROFILE%\vardena-signing" /inheritance:r /grant:r "%SIGNER_ACCOUNT%:(OI)(CI)(F)"
icacls "%USERPROFILE%\vardena-signing\authority.pkcs8" /inheritance:r /grant:r "%SIGNER_ACCOUNT%:(R)"
```

The first command gives the operator control of the dedicated directory; the
second gives the operator read-only access to the key file and removes every
inherited entry. If you prefer to grant the operator full control of the file
for rotation, replace `(R)` with `(F)`; the signer accepts either.

Verify the result:

```bat
icacls "%USERPROFILE%\vardena-signing\authority.pkcs8"
```

A minimal secure result contains exactly the operator entry, similar to:

```text
C:\Users\alice\vardena-signing\authority.pkcs8 DOMAIN\alice:(R)
Successfully processed 1 files; Failed processing 0 files
```

`icacls` does not print the owner. Confirm it is the signing account (or
`SYSTEM`/`Administrators`) with:

```powershell
Get-Acl "$env:USERPROFILE\vardena-signing\authority.pkcs8" |
  Select-Object -ExpandProperty Owner
```

If the listing contains `Everyone`, `BUILTIN\Users`,
`NT AUTHORITY\Authenticated Users`, another account, or an inherited entry from
a broader parent, the signer refuses. `icacls /inheritance:r` is the usual fix
for an inherited entry.

### What the signer does on Windows

The signer starts the fixed Windows PowerShell executable at
`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` with
`-NoLogo -NoProfile -NonInteractive -Command`. It runs a fixed script against
the file and receives a line-oriented identity/DACL summary. The key path is
passed only through the `VARDENA_SIGNER_KEY_PATH` environment variable; it is
never interpolated into PowerShell text and no shell is used, so a path
containing quotes, semicolons or `$()` is data rather than code. An absolute
System32 executable path is used instead of resolving `powershell.exe` through
`PATH`.

The following conditions all fail closed as `key-unavailable`:

- Windows PowerShell is not present, `%SystemRoot%`/`%WINDIR%` is missing or not
  absolute, or the executable cannot be started.
- The command exits non-zero, times out (15 s) or exceeds the output limit
  (1 MiB).
- The output is empty, contains a line the signer does not fully understand, is
  missing the owner or current user identity, contains duplicate identity
  lines, or contains an invalid access mask or access type.
- The DACL cannot be read, an ACE identity cannot be resolved, or the file has
  no access rules.
- The file owner is not the signing operator, `SYSTEM` or `Administrators`.
- Any effective allow ACE names a principal outside the accepted set above.
- The platform is neither a known POSIX platform nor `win32`.

The platform mode is not used as a Windows security signal. The signer does not
modify the file, copy it, change its mode, or rewrite its ACL.

## Supported environment and limits

- Use a **local NTFS volume** on the signing station. FAT/exFAT has no NTFS
  DACL and the inspection fails closed. Network shares are not a supported
  custody location for an air-gapped key.
- Windows PowerShell 5.1 (included with supported Windows client and server
  releases) must be available. A system with only PowerShell 7 and no Windows
  PowerShell is refused rather than checked differently.
- The signer checks the DACL and later reads the key by path. Like every
  path-based check, it does not eliminate a time-of-check/time-of-use race by a
  process that can already replace files in that directory. Keep the dedicated
  directory writable only by the operator; disk encryption and physical custody
  remain deployment controls.
- Accepting `SYSTEM` and `Administrators` is an explicit trust decision:
  local administrators can take ownership regardless of the DACL. It is not a
  claim that a compromised administrator account is contained.
- This validation is not a substitute for key custody, HSM/KMS policy, the
  U-1 compromise procedure, or the air-gap controls in the issuance design.

## Tests

Run from `owner-licensing/backend`:

```sh
npm run test:signer
```

On Windows this also runs the real-NTFS integration cases; on POSIX those cases
are skipped and the real POSIX mode cases run.

`test/signer-key-permissions.test.ts` covers:

- secure and insecure POSIX modes, including mode-only inputs on any host;
- an accepted restricted Windows DACL, including the reported `100666` mode;
- explicit and inherited grants to `Everyone`, `Users`, `Authenticated Users`,
  `Guests`, `INTERACTIVE` and unknown SIDs;
- an unapproved owner, and `SYSTEM`/`Administrators` owners;
- deny and inheritance-only entries;
- command failure, missing PowerShell, malformed/partial output, invalid masks,
  duplicate identities and unsupported platforms;
- the fixed command shape and environment-variable path transport;
- Windows-only integration tests that create real NTFS DACLs and prove a
  restricted file is accepted while explicit and inherited `BUILTIN\Users`
  grants are refused.

This test file contains no key material. The Windows integration cases use a
placeholder file, never a real private key.
