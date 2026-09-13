#!/usr/bin/env node
// Encrypts a Markdown document for the password-gated viewer pages.
//
// The site is served from a public repo, so a "hidden" page would still have
// its source readable on GitHub. This encrypts the body instead: only the
// ciphertext is committed, and the page decrypts it in the browser once the
// passphrase is entered. No server involved.
//
//   node dev-scripts/encrypt-doc.js <input.md> [output.enc.json]
//
// The passphrase is read from stdin (or the DOC_PASSPHRASE env var) so it
// never ends up in shell history. Re-run it any time to change the password.

const fs = require("fs");
const path = require("path");
const { webcrypto } = require("node:crypto");

const ITERATIONS = 250000;

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: node dev-scripts/encrypt-doc.js <input.md> [output.enc.json]");
    process.exit(1);
  }
  const output = process.argv[3] || input.replace(/\.md$/, "") + ".enc.json";

  const passphrase = (process.env.DOC_PASSPHRASE ?? readStdin()).trim();
  if (!passphrase) {
    console.error("passphrase is empty — pass it on stdin or in DOC_PASSPHRASE");
    process.exit(1);
  }

  const plaintext = fs.readFileSync(input);
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));

  const base = await webcrypto.subtle.importKey(
    "raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ct = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);

  const payload = {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations: ITERATIONS,
    salt: Buffer.from(salt).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
    ciphertext: Buffer.from(ct).toString("base64"),
  };
  fs.writeFileSync(output, JSON.stringify(payload) + "\n");
  console.log(`${path.basename(input)} -> ${path.basename(output)} (${plaintext.length} bytes encrypted)`);
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch (e) {
    return "";
  }
}

main();
