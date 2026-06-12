//! FROST custodian CLI — spec/conditional-disclosure.md §1, §5.
//!
//! Runs the RFC 9591 FROST(secp256k1, SHA-256) distributed key generation with
//! Taproot tweaking (`frost-secp256k1-tr`), so the aggregate output is a standard
//! BIP-340 Schnorr signature over the 32-byte disclosure `context`, verifiable by
//! the on-chain registries. The group secret never exists in one place — not at
//! the ceremony (DKG, no dealer) and not during signing (share aggregation).
//!
//! All rounds exchange JSON files through a shared directory; each custodian keeps
//! their `*.secret.json` files private and publishes the rest.
//!
//! Ceremony (each of the N custodians, in lockstep):
//!   frost-custodian dkg-part1   --id <i> --min M --max N --dir ceremony/
//!   frost-custodian dkg-part2   --id <i> --dir ceremony/
//!   frost-custodian dkg-finalize --id <i> --dir ceremony/
//!     → ceremony/keys/<i>.key.secret.json (private), ceremony/group.json (shared;
//!       contains the x-only group key for registerPolicy on both chains)
//!
//! Signing a disclosure context (any M custodians):
//!   frost-custodian sign-round1 --id <i> --key ceremony/keys/<i>.key.secret.json --dir signing/
//!   frost-custodian sign-round2 --id <i> --key ... --message <hex32> --dir signing/
//!   frost-custodian aggregate   --group ceremony/group.json --message <hex32> --dir signing/
//!     → signing/signature.json: { rx, ry, s } for the on-chain SchnorrSig tuple.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context as _, Result};
use clap::{Parser, Subcommand};
use frost_secp256k1_tr as frost;
use frost::keys::dkg;
use frost::Identifier;
use serde::{Deserialize, Serialize};

#[derive(Parser)]
#[command(name = "frost-custodian", about, version)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// DKG round 1: generate and broadcast a commitment package.
    DkgPart1 {
        #[arg(long)]
        id: u16,
        #[arg(long)]
        min: u16,
        #[arg(long)]
        max: u16,
        #[arg(long)]
        dir: PathBuf,
    },
    /// DKG round 2: read everyone's round-1 packages, emit per-recipient packages.
    DkgPart2 {
        #[arg(long)]
        id: u16,
        #[arg(long)]
        dir: PathBuf,
    },
    /// DKG round 3: derive the key share and the group public key.
    DkgFinalize {
        #[arg(long)]
        id: u16,
        #[arg(long)]
        dir: PathBuf,
    },
    /// Signing round 1: commit nonces for one signing session.
    SignRound1 {
        #[arg(long)]
        id: u16,
        #[arg(long)]
        key: PathBuf,
        #[arg(long)]
        dir: PathBuf,
    },
    /// Signing round 2: produce a signature share over the 32-byte hex message.
    SignRound2 {
        #[arg(long)]
        id: u16,
        #[arg(long)]
        key: PathBuf,
        #[arg(long)]
        message: String,
        #[arg(long)]
        dir: PathBuf,
    },
    /// Aggregate signature shares into the final BIP-340 signature.
    Aggregate {
        #[arg(long)]
        group: PathBuf,
        #[arg(long)]
        message: String,
        #[arg(long)]
        dir: PathBuf,
    },
}

#[derive(Serialize, Deserialize)]
struct HexBlob {
    hex: String,
}

#[derive(Serialize, Deserialize)]
struct GroupInfo {
    /// PublicKeyPackage bytes (hex) — needed for aggregation.
    public_key_package: String,
    /// x-only BIP-340 group public key (hex, 32 bytes) — registerPolicy input.
    group_key_x: String,
    min_signers: u16,
    max_signers: u16,
}

#[derive(Serialize, Deserialize)]
struct SignatureOut {
    /// SchnorrSig tuple for the on-chain registries.
    rx: String,
    ry: String,
    s: String,
    /// 64-byte BIP-340 signature (Rx ‖ s), hex.
    bip340: String,
    message: String,
    group_key_x: String,
}

fn write_json<T: Serialize>(path: &Path, v: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(v)?)?;
    println!("wrote {}", path.display());
    Ok(())
}

fn read_blob(path: &Path) -> Result<Vec<u8>> {
    let blob: HexBlob = serde_json::from_str(
        &fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?,
    )?;
    Ok(hex::decode(blob.hex)?)
}

fn ident(id: u16) -> Result<Identifier> {
    Identifier::try_from(id).map_err(|e| anyhow::anyhow!("bad identifier {id}: {e}"))
}

/// Collect `<n>.json` files (n = participant id) from a directory into a map,
/// optionally excluding one id.
fn collect<T, F: Fn(&[u8]) -> Result<T>>(
    dir: &Path,
    exclude: Option<u16>,
    parse: F,
) -> Result<BTreeMap<Identifier, T>> {
    let mut out = BTreeMap::new();
    for entry in fs::read_dir(dir).with_context(|| format!("reading {}", dir.display()))? {
        let path = entry?.path();
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        let Ok(id) = stem.parse::<u16>() else { continue };
        if Some(id) == exclude {
            continue;
        }
        out.insert(ident(id)?, parse(&read_blob(&path)?)?);
    }
    Ok(out)
}

/// x-only group key + even-Y lift of an Rx, via k256.
fn lift_x(x: &[u8; 32]) -> Result<[u8; 32]> {
    use k256::elliptic_curve::sec1::{FromEncodedPoint, ToEncodedPoint};
    use k256::EncodedPoint;
    // 0x02 prefix = even Y compressed point.
    let mut compressed = [0u8; 33];
    compressed[0] = 0x02;
    compressed[1..].copy_from_slice(x);
    let point = k256::AffinePoint::from_encoded_point(
        &EncodedPoint::from_bytes(compressed).context("bad x coordinate")?,
    );
    let point = Option::<k256::AffinePoint>::from(point).context("x not on curve")?;
    let uncompressed = point.to_encoded_point(false);
    let y: [u8; 32] = uncompressed.y().context("no y")?.as_slice().try_into()?;
    Ok(y)
}

/// The verifying key serialized x-only. frost-secp256k1-tr's effective (tweaked)
/// group key is even-Y per BIP-340; serialize() yields 33-byte SEC1.
fn group_key_x(pkg: &frost::keys::PublicKeyPackage) -> Result<[u8; 32]> {
    let sec1 = pkg.verifying_key().serialize()?;
    match sec1.len() {
        33 => Ok(sec1[1..].try_into()?),
        32 => Ok(sec1.as_slice().try_into()?),
        n => bail!("unexpected verifying key length {n}"),
    }
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let mut rng = rand::rngs::OsRng;

    match cli.cmd {
        Cmd::DkgPart1 { id, min, max, dir } => {
            let (secret, package) = dkg::part1(ident(id)?, max, min, &mut rng)?;
            write_json(
                &dir.join(format!("round1-secrets/{id}.secret.json")),
                &HexBlob { hex: hex::encode(secret.serialize()?) },
            )?;
            write_json(
                &dir.join(format!("round1/{id}.json")),
                &HexBlob { hex: hex::encode(package.serialize()?) },
            )?;
        }

        Cmd::DkgPart2 { id, dir } => {
            let secret = dkg::round1::SecretPackage::deserialize(&read_blob(
                &dir.join(format!("round1-secrets/{id}.secret.json")),
            )?)?;
            let round1 = collect(&dir.join("round1"), Some(id), |b| {
                Ok(dkg::round1::Package::deserialize(b)?)
            })?;
            let (secret2, packages) = dkg::part2(secret, &round1)?;
            write_json(
                &dir.join(format!("round2-secrets/{id}.secret.json")),
                &HexBlob { hex: hex::encode(secret2.serialize()?) },
            )?;
            for (recipient, pkg) in packages {
                // Identifier serializes as a 32-byte big-endian scalar; the u16 id
                // we assigned lives in the last two bytes.
                let ser = recipient.serialize();
                let r = u16::from_be_bytes(ser[ser.len() - 2..].try_into()?);
                write_json(
                    &dir.join(format!("round2/{}/{id}.json", r)),
                    &HexBlob { hex: hex::encode(pkg.serialize()?) },
                )?;
            }
        }

        Cmd::DkgFinalize { id, dir } => {
            let secret2 = dkg::round2::SecretPackage::deserialize(&read_blob(
                &dir.join(format!("round2-secrets/{id}.secret.json")),
            )?)?;
            let round1 = collect(&dir.join("round1"), Some(id), |b| {
                Ok(dkg::round1::Package::deserialize(b)?)
            })?;
            let round2 = collect(&dir.join(format!("round2/{id}")), None, |b| {
                Ok(dkg::round2::Package::deserialize(b)?)
            })?;
            let (key_package, pubkey_package) = dkg::part3(&secret2, &round1, &round2)?;
            write_json(
                &dir.join(format!("keys/{id}.key.secret.json")),
                &HexBlob { hex: hex::encode(key_package.serialize()?) },
            )?;
            let gkx = group_key_x(&pubkey_package)?;
            write_json(
                &dir.join("group.json"),
                &GroupInfo {
                    public_key_package: hex::encode(pubkey_package.serialize()?),
                    group_key_x: hex::encode(gkx),
                    min_signers: *key_package.min_signers(),
                    max_signers: 0, // not tracked by KeyPackage; informational only
                },
            )?;
            println!("group key (x-only): 0x{}", hex::encode(gkx));
        }

        Cmd::SignRound1 { id, key, dir } => {
            let key_package = frost::keys::KeyPackage::deserialize(&read_blob(&key)?)?;
            let (nonces, commitments) = frost::round1::commit(key_package.signing_share(), &mut rng);
            write_json(
                &dir.join(format!("nonces/{id}.secret.json")),
                &HexBlob { hex: hex::encode(nonces.serialize()?) },
            )?;
            write_json(
                &dir.join(format!("commitments/{id}.json")),
                &HexBlob { hex: hex::encode(commitments.serialize()?) },
            )?;
        }

        Cmd::SignRound2 { id, key, message, dir } => {
            let msg = parse_msg32(&message)?;
            let key_package = frost::keys::KeyPackage::deserialize(&read_blob(&key)?)?;
            let nonces = frost::round1::SigningNonces::deserialize(&read_blob(
                &dir.join(format!("nonces/{id}.secret.json")),
            )?)?;
            let commitments = collect(&dir.join("commitments"), None, |b| {
                Ok(frost::round1::SigningCommitments::deserialize(b)?)
            })?;
            let signing_package = frost::SigningPackage::new(commitments, &msg);
            let share = frost::round2::sign(&signing_package, &nonces, &key_package)?;
            write_json(
                &dir.join(format!("shares/{id}.json")),
                &HexBlob { hex: hex::encode(share.serialize()) },
            )?;
        }

        Cmd::Aggregate { group, message, dir } => {
            let msg = parse_msg32(&message)?;
            let info: GroupInfo = serde_json::from_str(&fs::read_to_string(&group)?)?;
            let pubkey_package = frost::keys::PublicKeyPackage::deserialize(&hex::decode(
                &info.public_key_package,
            )?)?;
            let commitments = collect(&dir.join("commitments"), None, |b| {
                Ok(frost::round1::SigningCommitments::deserialize(b)?)
            })?;
            let shares = collect(&dir.join("shares"), None, |b| {
                Ok(frost::round2::SignatureShare::deserialize(b)?)
            })?;
            let signing_package = frost::SigningPackage::new(commitments, &msg);
            let signature = frost::aggregate(&signing_package, &shares, &pubkey_package)?;
            // Defense in depth: verify before emitting.
            pubkey_package.verifying_key().verify(&msg, &signature)?;

            let sig_bytes = signature.serialize()?;
            if sig_bytes.len() != 64 {
                bail!("expected 64-byte BIP-340 signature, got {}", sig_bytes.len());
            }
            let rx: [u8; 32] = sig_bytes[..32].try_into()?;
            let ry = lift_x(&rx)?;
            let out = SignatureOut {
                rx: hex::encode(rx),
                ry: hex::encode(ry),
                s: hex::encode(&sig_bytes[32..]),
                bip340: hex::encode(&sig_bytes),
                message: hex::encode(msg),
                group_key_x: info.group_key_x,
            };
            write_json(&dir.join("signature.json"), &out)?;
            println!("signature: 0x{}", out.bip340);
        }
    }
    Ok(())
}

fn parse_msg32(s: &str) -> Result<[u8; 32]> {
    let bytes = hex::decode(s.trim_start_matches("0x"))?;
    if bytes.len() != 32 {
        bail!("message must be 32 bytes (the disclosure context), got {}", bytes.len());
    }
    Ok(bytes.try_into().unwrap())
}
