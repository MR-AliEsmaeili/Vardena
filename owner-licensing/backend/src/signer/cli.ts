#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import type { KeyObject } from "node:crypto";
import {
  SignerError,
  assertKeyFilePrivate,
  assertSignerEnvironment,
  signLicenseRequest,
  signRevocationRequest,
} from "./signer.js";
import { parsePrivateKey } from "../protocol.js";

/**
 * Offline signer CLI. Runs only on the operator's air-gapped machine.
 *
 *   node dist-signer/cli.js sign-license \
 *     --request request.json --key key.pkcs8 --key-id sha256-… \
 *     --out signed-license.json [--state ~/.vardena-signed.log] \
 *     [--digest-file digest.txt]
 *
 * The expected request digest is read from **stdin** unless `--digest-file` is
 * supplied. It is deliberately NOT accepted as a command-line argument: argv is
 * visible in process lists and shell history, and the value must come from a
 * channel independent of the request file.
 */

interface Args {
  command: "sign-license" | "sign-revocation";
  request: string;
  key: string;
  keyId: string;
  out: string;
  state?: string;
  digestFile?: string;
}

function usage(): string {
  return [
    "Usage:",
    "  vardena-signer sign-license --request <file> --key <file> --key-id <id> --out <file> [--state <file>] [--digest-file <file>]",
    "  vardena-signer sign-revocation --request <file> --key <file> --key-id <id> --out <file> [--state <file>] [--digest-file <file>]",
    "",
    "The 64-hex request digest is read from stdin unless --digest-file is given.",
  ].join("\n");
}

function parse(argv: string[]): Args {
  const command = argv[0];
  if (command !== "sign-license" && command !== "sign-revocation")
    throw new SignerError("request-malformed", usage());
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (!arg.startsWith("--")) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--"))
      throw new SignerError("request-malformed", `Missing value for ${arg}.`);
    values.set(arg.slice(2), value);
    index += 1;
  }
  const required = (name: string) => {
    const value = values.get(name);
    if (!value)
      throw new SignerError("request-malformed", `--${name} is required.`);
    return value;
  };
  return {
    command,
    request: required("request"),
    key: required("key"),
    keyId: required("key-id"),
    out: required("out"),
    ...(values.has("state") ? { state: values.get("state") as string } : {}),
    ...(values.has("digest-file")
      ? { digestFile: values.get("digest-file") as string }
      : {}),
  };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new SignerError(
      "digest-missing",
      "Enter the 64-hex request digest on stdin (or use --digest-file).",
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin)
    chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  assertSignerEnvironment();
  const args = parse(process.argv.slice(2));
  const requestContent = await readFile(args.request, "utf8");
  const expectedDigest =
    args.digestFile !== undefined
      ? await readFile(args.digestFile, "utf8")
      : await readStdin();

  await assertKeyFilePrivate(args.key);
  // The loader is only invoked by the signer after every pre-key control has
  // passed; the CLI itself never reads the key file earlier.
  const loadPrivateKey = async (): Promise<KeyObject> =>
    parsePrivateKey(await readFile(args.key, "utf8"));

  const result =
    args.command === "sign-license"
      ? await signLicenseRequest({
          requestContent,
          expectedDigest,
          keyId: args.keyId,
          loadPrivateKey,
          ...(args.state === undefined ? {} : { statePath: args.state }),
        })
      : await signRevocationRequest({
          requestContent,
          expectedDigest,
          keyId: args.keyId,
          loadPrivateKey,
          ...(args.state === undefined ? {} : { statePath: args.state }),
        });

  await writeFile(args.out, result.envelope, { encoding: "utf8", flag: "wx" });
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        fileName: result.fileName,
        operationId: "operationId" in result ? result.operationId : undefined,
        revocationId:
          "revocationId" in result ? result.revocationId : undefined,
        keyId: result.keyId,
        requestPayloadSha256: result.requestPayloadSha256,
        requestBindingSha256: result.requestBindingSha256,
        artifactSha256: result.artifactSha256,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  if (error instanceof SignerError) {
    process.stderr.write(`refused\t${error.code}\t${error.message}\n`);
    process.exit(error.exitCode);
  }
  process.stderr.write("refused\tsigner-failure\tThe signer refused.\n");
  process.exit(2);
});
