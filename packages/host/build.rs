use std::{env, fs, path::Path};

fn collect(root: &Path, dir: &Path, output: &mut String) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.map(Result::unwrap).collect();
    entries.sort_by_key(|entry| entry.path());
    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            collect(root, &path, output);
        } else {
            let name = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let path = fs::canonicalize(path).unwrap();
            output.push_str(&format!(
                "({name:?}, include_bytes!({:?})),\n",
                path.to_string_lossy()
            ));
        }
    }
}

fn main() {
    let root = Path::new("../../apps/web/dist");
    println!("cargo:rerun-if-changed={}", root.display());
    let mut output = String::from("pub static ASSETS: &[(&str, &[u8])] = &[\n");
    collect(root, root, &mut output);
    output.push_str("];\n");
    fs::write(
        Path::new(&env::var("OUT_DIR").unwrap()).join("assets.rs"),
        output,
    )
    .unwrap();
}
