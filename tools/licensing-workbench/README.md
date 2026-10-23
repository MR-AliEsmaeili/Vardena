# Vardena Local Licensing Workbench (Windows)

This is a local Windows Forms front end for the existing Vardena offline signer. It reduces command-line use for key generation and signing. The Owner web app still prepares issuance/revocation requests and imports signed artifacts; the customer app still imports the issued license separately.

## Requirements

- Windows PowerShell 5.1 and Windows Forms.
- Node.js 22.12 or newer, npm, and the Vardena repository checked out locally.
- Run this tool from the repository copy that contains `owner-licensing/backend`.
- The signer requires a private key file and signing directory whose permissions it can verify. Windows uses the file's actual NTFS DACL; POSIX retains the restrictive mode check.

## Start

From PowerShell at the repository root:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\tools\licensing-workbench\Start-VardenaLicensingWorkbench.ps1
```

The execution-policy command affects only the current PowerShell process. If your organization's policy prohibits scripts, do not bypass it; use an approved method to run the tool.

## Existing signing key

1. Use **Select folder** to choose the folder containing the existing `key.pkcs8` file.
2. Enter the key ID registered in Owner and trusted by the customer backend.
3. Do not click **Generate new key** just to fix an existing installation. A new key is a new trust authority and will not automatically verify in customer installations.
4. Click **Build signer** when the signer build is missing or source code changed.

## New signing key

1. Click **Build signer**.
2. Select a parent folder, then click **Generate new key**. The tool creates a timestamped subfolder and removes inherited ACLs before granting the current Windows account access.
3. The tool creates `key.pkcs8`, `public-key.txt`, and `key-info.json`. The private key is not displayed in the UI or sent to a service.
4. Back up `key.pkcs8` securely. Never commit it, upload it to GitHub, or paste its contents into chat.
5. Before issuing with a new key, register its public key/Key ID in Owner and configure the corresponding public-key trust in the customer runtime. Deploy the trust update and verify it before issuing a production license. Key rotation is not automatic.

## Sign a license or revocation request

1. Prepare the request in Owner and download the unsigned request file.
2. Copy the exact **`request_payload_sha256`** value from Owner. Do not use `request_binding_sha256`; the two digests serve different purposes.
3. In the workbench, select the request file and click **Set digest from Owner**. Paste the 64-character lowercase hexadecimal payload digest. The tool validates the shape and writes `request-digest.txt` locally.
4. Verify the key folder and Key ID, then click **Sign license** or **Sign revocation** and choose a new output filename.
5. The signer checks the request, digest, key ID, date rules, key-file permissions, and duplicate-operation state before using the private key. Existing output files are never overwritten. Keep `signer-state.log`; do not delete it to retry an operation that was already signed.
6. Import the signed file into Owner. Only after Owner confirms the import, separately import the same signed file into the customer application if the workflow requires customer activation.

## Important boundaries

- The workbench does not connect to Owner's database or make HTTP requests to the Owner/customer applications. It only opens their local pages from its buttons.
- It does not issue a license by itself: Owner must prepare and accept the relevant operation, and the customer runtime independently verifies/applies the signed artifact.
- It does not repair or reactivate an existing license automatically. Diagnose runtime status and trust configuration before issuing a replacement.
- Do not generate a new key as a troubleshooting step for an existing license. A changed key ID requires deliberate trust-list configuration.
- Never delete the signer replay-state file as a shortcut. It is part of duplicate-operation protection.
- This workbench has not been run on the user's machine from this repository change. Run the lightweight build and a disposable test flow before using it for a real signing operation.
