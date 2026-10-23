fn main() {
    println!("cargo:rustc-check-cfg=cfg(veil_discord_sdk)");
    println!("cargo:rerun-if-env-changed=VEIL_DISCORD_SDK_DIR");
    println!("cargo:rerun-if-env-changed=VEIL_DISCORD_SDK_DISABLED");
    println!("cargo:rerun-if-changed=src/discord/sdk.cpp");
    let explicit = std::env::var_os("VEIL_DISCORD_SDK_DIR");
    let root = explicit
        .clone()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap())
                .join("../../../.local/discord-social-sdk")
        });
    println!(
        "cargo:rerun-if-changed={}",
        root.join("include/discordpp.h").display()
    );
    if std::env::var_os("VEIL_DISCORD_SDK_DISABLED").is_some() {
        tauri_build::build();
        return;
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("x86_64")
        && root.join("include/discordpp.h").is_file()
    {
        for file in [
            "include/discordpp.h",
            "include/cdiscord.h",
            "lib/release/discord_partner_sdk.lib",
            "bin/release/discord_partner_sdk.dll",
            "License-Notices.txt",
        ] {
            assert!(
                root.join(file).is_file(),
                "Discord SDK asset is missing: {file}"
            );
            println!("cargo:rerun-if-changed={}", root.join(file).display());
        }
        cc::Build::new()
            .cpp(true)
            .std("c++20")
            .flag_if_supported("/EHsc")
            .include(root.join("include"))
            .file("src/discord/sdk.cpp")
            .compile("veil_discord_bridge");
        println!(
            "cargo:rustc-link-search=native={}",
            root.join("lib/release").display()
        );
        println!("cargo:rustc-link-lib=dylib=discord_partner_sdk");
        println!("cargo:rustc-cfg=veil_discord_sdk");
        let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let profile = out.ancestors().nth(3).expect("Cargo profile directory");
        copy_changed(
            &root.join("bin/release/discord_partner_sdk.dll"),
            &profile.join("discord_partner_sdk.dll"),
        );
        copy_changed(
            &root.join("License-Notices.txt"),
            &profile.join("Discord-License-Notices.txt"),
        );
    } else if explicit.is_some() {
        panic!("VEIL_DISCORD_SDK_DIR must point to an extracted Windows x64 Social SDK");
    }
    tauri_build::build();
}
fn copy_changed(source: &std::path::Path, destination: &std::path::Path) {
    let bytes = std::fs::read(source).expect("Read Discord SDK asset");
    if std::fs::read(destination).ok().as_ref() != Some(&bytes) {
        std::fs::write(destination, bytes).expect("Stage Discord runtime/notices; close this worktree's Veil executable before replacing a loaded runtime");
    }
}
