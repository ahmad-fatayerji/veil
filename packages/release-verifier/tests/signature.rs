use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};

#[test]
#[ignore = "Requires VEIL_TEST_INSTALLER to point to a real packaged installer"]
fn packaged_installer_rejects_tampering() {
    let installer = std::env::var("VEIL_TEST_INSTALLER").expect("Set VEIL_TEST_INSTALLER");
    let config: serde_json::Value = serde_json::from_str(include_str!(
        "../../../apps/desktop/src-tauri/tauri.conf.json"
    ))
    .unwrap();
    let key = STANDARD
        .decode(config["plugins"]["updater"]["pubkey"].as_str().unwrap())
        .unwrap();
    let public_key = PublicKey::decode(std::str::from_utf8(&key).unwrap()).unwrap();
    let encoded_signature = std::fs::read_to_string(format!("{installer}.sig")).unwrap();
    let signature = STANDARD.decode(encoded_signature.trim()).unwrap();
    let signature = Signature::decode(std::str::from_utf8(&signature).unwrap()).unwrap();
    let mut bytes = std::fs::read(installer).unwrap();
    public_key
        .verify(&bytes, &signature, true)
        .expect("Installer must verify with the embedded public key");
    assert!(
        signature
            .trusted_comment()
            .contains(config["version"].as_str().unwrap()),
        "Signature must bind the release version"
    );
    let last = bytes.len() - 1;
    bytes[last] ^= 1;
    assert!(
        public_key.verify(&bytes, &signature, true).is_err(),
        "One modified byte must invalidate the package"
    );
}
